import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runSelfCheck } from '../src/selfcheck.js'

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

