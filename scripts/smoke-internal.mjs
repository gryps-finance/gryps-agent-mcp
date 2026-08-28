import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const address = process.argv[2] ?? '0x0000000000000000000000000000000000000000'
assert.match(address, /^0x[0-9a-fA-F]{40}$/)

const child = spawn(
  process.execPath,
  [fileURLToPath(new URL('../internal-dist/internal-src/index.js', import.meta.url)), `--account-address=${address}`],
  { stdio: ['pipe', 'pipe', 'pipe'] },
)

let stdout = ''
let stderr = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => { stdout += chunk })
child.stderr.on('data', (chunk) => { stderr += chunk })

const messages = [
  {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gryps-observer-smoke', version: '1.0.0' } },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'gryps_account_snapshot', arguments: {} } },
  { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'gryps_account_portfolio', arguments: {} } },
  { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'gryps_account_order_history', arguments: { limit: 20, offset: 0 } } },
  { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'gryps_account_trades', arguments: { limit: 20, offset: 0 } } },
]
for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`)

const deadline = Date.now() + 20_000
while (Date.now() < deadline && !stdout.split('\n').some((line) => line.includes('"id":6'))) {
  await new Promise((resolve) => setTimeout(resolve, 25))
}
child.kill()

const responses = stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))
const listed = responses.find((response) => response.id === 2)
assert.ok(listed, `No tools/list response. stderr: ${stderr}`)
assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
  'gryps_account_snapshot',
  'gryps_account_portfolio',
  'gryps_account_order_history',
  'gryps_account_trades',
])
for (const tool of listed.result.tools) {
  assert.equal(tool.annotations?.readOnlyHint, true)
  assert.equal(tool.annotations?.destructiveHint, false)
}

for (const id of [3, 4, 5, 6]) {
  const response = responses.find((candidate) => candidate.id === id)
  assert.ok(response, `No tool response for id ${id}. stderr: ${stderr}`)
  assert.equal(response.result.isError, undefined, JSON.stringify(response.result.structuredContent))
  assert.equal(response.result.structuredContent.status, 'ok')
  assert.equal(response.result.structuredContent.meta.accountAddress.toLowerCase(), address.toLowerCase())
}

process.stdout.write(`Internal observer live smoke passed: 4 fixed-account read tools for ${address}.\n`)
