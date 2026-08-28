import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const npmCli = process.env.npm_execpath
assert.ok(npmCli, 'npm_execpath is required for clean-install verification')
const temporaryRoot = mkdtempSync(join(tmpdir(), 'gryps-agent-mcp-'))

try {
  const packOutput = execFileSync(
    process.execPath,
    [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
    { cwd: packageRoot, encoding: 'utf8', env: { ...process.env, npm_config_update_notifier: 'false' } },
  )
  const [pack] = JSON.parse(packOutput)
  assert.ok(pack?.filename)
  const tarball = join(temporaryRoot, pack.filename)
  assert.ok(existsSync(tarball))

  execFileSync(
    process.execPath,
    [
      npmCli,
      'install',
      tarball,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--cache',
      join(packageRoot, '.npm-cache'),
    ],
    { cwd: temporaryRoot, stdio: 'pipe', env: { ...process.env, npm_config_update_notifier: 'false' } },
  )

  const binary = join(
    temporaryRoot,
    'node_modules',
    '@gryps',
    'agent-mcp',
    'dist',
    'index.js',
  )
  assert.ok(existsSync(binary), 'Installed package is missing its MCP binary')
  const child = spawn(process.execPath, [binary], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'clean-install-smoke', version: '1.0.0' },
      },
    })}\n`,
  )

  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && !stdout.includes('"id":1')) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  child.kill()
  assert.match(stdout, /"name":"gryps-agent-mcp"/, `Installed MCP did not initialise. ${stderr}`)
  process.stdout.write('Clean packed-package install and MCP start passed.\n')
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
