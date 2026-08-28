import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PUBLIC_TOOL_NAMES } from '../src/constants.js'
import { createPublicServer } from '../src/server.js'
import { fixtureFetch, testConfig } from './fixtures.js'

async function connectedClient() {
  const server = createPublicServer(testConfig, { fetcher: fixtureFetch(), retryDelayMs: 0 })
  const client = new Client({ name: 'gryps-server-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return { client, server }
}

test('exposes exactly the frozen public tool list with read-only annotations', async () => {
  const { client } = await connectedClient()
  const listed = await client.listTools()
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [...PUBLIC_TOOL_NAMES],
  )
  for (const tool of listed.tools) {
    assert.equal(tool.annotations?.readOnlyHint, true)
    assert.equal(tool.annotations?.destructiveHint, false)
  }
  await client.close()
})

test('serves a full market read through the MCP wire protocol', async () => {
  const { client } = await connectedClient()
  const response = await client.callTool({
    name: 'gryps_get_market',
    arguments: { symbol: 'BTC' },
  })
  assert.notEqual(response.isError, true)
  const payload = response.structuredContent as {
    status: string
    data: { market: { symbol: string }; price: { usd: number } }
    meta: { readOnly: boolean }
  }
  assert.equal(payload.status, 'ok')
  assert.equal(payload.data.market.symbol, 'BTCUSDT')
  assert.equal(payload.data.price.usd, 79_620.6)
  assert.equal(payload.meta.readOnly, true)
  await client.close()
})

test('returns a typed sanitised error envelope for an unknown symbol', async () => {
  const { client } = await connectedClient()
  const response = await client.callTool({
    name: 'gryps_get_market',
    arguments: { symbol: 'DOESNOTEXIST' },
  })
  assert.equal(response.isError, true)
  const payload = response.structuredContent as {
    status: string
    error: { code: string; message: string }
  }
  assert.equal(payload.status, 'error')
  assert.equal(payload.error.code, 'not_found')
  await client.close()
})

test('maps an unavailable upstream to a sanitised upstream_unavailable envelope', async () => {
  const failingFetch: typeof fetch = async () => {
    throw new Error('connect ECONNREFUSED 10.0.0.7')
  }
  const server = createPublicServer(testConfig, { fetcher: failingFetch, retryDelayMs: 0 })
  const client = new Client({ name: 'gryps-server-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const response = await client.callTool({ name: 'gryps_venue_status', arguments: {} })
  assert.equal(response.isError, true)
  const payload = response.structuredContent as { error: { code: string; message: string } }
  assert.equal(payload.error.code, 'upstream_unavailable')
  assert.doesNotMatch(payload.error.message, /ECONNREFUSED|10\.0\.0\.7/)
  await client.close()
})
