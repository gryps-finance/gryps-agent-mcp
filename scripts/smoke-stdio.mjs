import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PUBLIC_TOOL_NAMES } from '../dist/constants.js'

const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url))], {
  stdio: ['pipe', 'pipe', 'pipe'],
})

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

const messages = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'gryps-release-smoke', version: '1.0.0' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
]

for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`)

const deadline = Date.now() + 20_000
while (Date.now() < deadline && !stdout.split('\n').some((line) => line.includes('"id":2'))) {
  await new Promise((resolve) => setTimeout(resolve, 25))
}

child.kill()
const responses = stdout
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const toolResponse = responses.find((response) => response.id === 2)
assert.ok(toolResponse, `No tools/list response. stderr: ${stderr}`)
const names = toolResponse.result.tools.map((tool) => tool.name)
assert.deepEqual(names, [...PUBLIC_TOOL_NAMES])
for (const tool of toolResponse.result.tools) {
  assert.equal(tool.annotations?.readOnlyHint, true)
  assert.equal(tool.annotations?.destructiveHint, false)
}
process.stdout.write(`MCP stdio smoke passed with ${names.length} public read tools.\n`)

/**
 * The self-audit runs against built output, so it is asserted here rather than
 * in the unit suite, which runs before the build in the release chain.
 */
const verify = execFileSync(process.execPath, [
  fileURLToPath(new URL('../dist/index.js', import.meta.url)),
  '--verify',
  '--json',
], { encoding: 'utf8' })
const audit = JSON.parse(verify)
assert.equal(audit.passed, true, 'the shipped package must pass its own audit')
assert.deepEqual(audit.toolsRegistered, [...PUBLIC_TOOL_NAMES])
assert.deepEqual(
  audit.networkDestinations,
  [
    // Order-book depth for cost comparison and the external reference mid.
    'https://api.hyperliquid.xyz',
    // The venue itself.
    'https://perps-api.orbs.network',
    // Settlement event log, for fees measured from fills rather than advertised.
    'https://polygon.blockscout.com',
  ],
  'a new network destination in shipped code must be a deliberate decision',
)
for (const check of audit.checks) {
  assert.equal(check.passed, true, `self-audit check failed: ${check.id}`)
}
process.stdout.write(
  `Self-audit passed: ${audit.checks.length} capability checks, ${audit.networkDestinations.length} network destinations.\n`,
)
