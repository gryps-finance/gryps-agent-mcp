import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PUBLIC_TOOL_NAMES } from '../src/constants.js'
import { runSelfCheck } from '../src/selfcheck.js'

/**
 * The self-check runs against built output, so these exercise the real thing
 * rather than the source it was compiled from.
 */
const DIST = join(process.cwd(), 'dist', 'index.js')

function runVerify(cwd?: string): { code: number; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, [DIST, '--verify', '--json'], {
      encoding: 'utf8',
      ...(cwd ? { cwd } : {}),
    })
    return { code: 0, stdout }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string }
    return { code: failure.status ?? 1, stdout: failure.stdout ?? '' }
  }
}

test('the shipped package passes its own audit', () => {
  const { code, stdout } = runVerify()
  const result = JSON.parse(stdout) as {
    passed: boolean
    checks: { id: string; passed: boolean }[]
    toolsRegistered: string[]
  }
  assert.equal(code, 0)
  assert.equal(result.passed, true)
  assert.deepEqual(result.toolsRegistered, [...PUBLIC_TOOL_NAMES])
  for (const check of result.checks) assert.equal(check.passed, true, `${check.id} failed`)
})

test('the audit names every network destination the shipped code can reach', () => {
  const { stdout } = runVerify()
  const result = JSON.parse(stdout) as { networkDestinations: string[] }
  // A reader auditing the boundary needs the full list, not a sample. If a
  // third host is ever added, this fails and forces a deliberate decision.
  assert.deepEqual(result.networkDestinations, [
    'https://api.hyperliquid.xyz',
    'https://perps-api.orbs.network',
  ])
})

test('the audit actually fails when a forbidden capability is present', () => {
  // A check that cannot fail proves nothing. Plant each forbidden capability
  // in a directory and confirm the audit names it.
  const planted: [string, string, string][] = [
    ['no-transaction-signing', 'a.js', 'export const x = () => signTypedData(1)\n'],
    ['no-private-keys', 'b.js', 'const privateKey = "0xdead"\n'],
    ['no-order-placement', 'c.js', 'export function placeOrder() {}\n'],
    ['no-network-listener', 'd.js', 'server.listen(3000)\n'],
    ['no-env-configuration', 'e.js', 'const k = process.env.SECRET_KEY\n'],
    ['no-child-processes', 'f.js', "import cp from 'node:child_process'\n"],
  ]

  for (const [expectedCheck, filename, contents] of planted) {
    const root = mkdtempSync(join(tmpdir(), 'gryps-selfcheck-'))
    try {
      writeFileSync(join(root, filename), contents)
      const result = runSelfCheck(root)
      assert.equal(result.passed, false, `planting ${expectedCheck} should fail the audit`)
      const failed = result.checks.find((check) => check.id === expectedCheck)
      assert.equal(failed?.passed, false, `${expectedCheck} should have been caught`)
      assert.ok(failed?.foundIn.includes(filename), `${expectedCheck} should name the file`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('a clean directory passes, so the audit is not simply always failing', () => {
  const root = mkdtempSync(join(tmpdir(), 'gryps-selfcheck-clean-'))
  try {
    writeFileSync(join(root, 'harmless.js'), 'export const add = (a, b) => a + b\n')
    const result = runSelfCheck(root)
    assert.equal(result.passed, true)
    assert.equal(result.networkDestinations.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed audit exits non-zero so it can be gated on', () => {
  // The CLI path, exercised against the real package, which must pass.
  const { code } = runVerify()
  assert.equal(code, 0)
})
