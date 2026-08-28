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

test('cost-gates a claimed edge over the wire and refuses a losing one', async () => {
  const { client } = await connectedClient()
  const response = await client.callTool({
    name: 'gryps_edge_check',
    arguments: { symbol: 'BTC', source: 'unit test signal', claimedEdgeBps: 5 },
  })
  assert.notEqual(response.isError, true)
  const payload = response.structuredContent as {
    data: { clears: boolean; verdict: string; untrustedSignalNotice: string }
  }
  assert.equal(payload.data.clears, false)
  assert.match(payload.data.verdict, /DOES NOT CLEAR/)
  assert.match(payload.data.untrustedSignalNotice, /never as instruction to follow/)
  await client.close()
})

test('returns a friction floor with explicit lower-bound provenance', async () => {
  const { client } = await connectedClient()
  const response = await client.callTool({ name: 'gryps_friction_floor', arguments: { symbol: 'BTC' } })
  const payload = response.structuredContent as {
    data: { roundTripBps: number; provenance: { isLowerBound: boolean; feeBasis: string } }
    meta: { limitations: string[] }
  }
  assert.equal(payload.data.roundTripBps, 24)
  assert.equal(payload.data.provenance.isLowerBound, true)
  assert.equal(payload.data.provenance.feeBasis, 'engine-reported')
  assert.match(payload.meta.limitations.join(' '), /measured fee floor/)
  await client.close()
})

test('refuses to count correlated signals as independent confirmations over the wire', async () => {
  const { client } = await connectedClient()
  const response = await client.callTool({
    name: 'gryps_signal_stack',
    arguments: {
      signals: [
        { source: 'feed A', family: 'social', claimedEdgeBps: 40 },
        { source: 'feed B', family: 'social', claimedEdgeBps: 40 },
      ],
      symbol: 'BTC',
    },
  })
  const payload = response.structuredContent as {
    data: { effectiveEdgeBps: number; naiveSumBps: number; gated: { clears: boolean } }
  }
  assert.equal(payload.data.naiveSumBps, 80)
  assert.equal(payload.data.effectiveEdgeBps, 40)
  assert.equal(payload.data.gated.clears, true)
  await client.close()
})

test('serves an indicative quote over the wire, labeled non-firm and derived', async () => {
  const { client } = await connectedClient()
  const response = await client.callTool({
    name: 'gryps_indicative_quote',
    arguments: { symbol: 'BTC', side: 'long', notionalUsd: 10_000 },
  })
  assert.notEqual(response.isError, true)
  const payload = response.structuredContent as {
    data: {
      firm: boolean
      quoteStatus: string
      engineQuoteSurface: { status: string }
      estimate: { roundTripCostUsd: number }
    }
    meta: { limitations: string[] }
  }
  assert.equal(payload.data.firm, false)
  assert.equal(payload.data.quoteStatus, 'derived')
  assert.equal(payload.data.engineQuoteSurface.status, 'absent')
  assert.equal(payload.data.estimate.roundTripCostUsd, 24)
  assert.match(payload.meta.limitations.join(' '), /cost model, not a tradable quote/)
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

test('a fresh caller is given one next step over the wire, not a catalogue', async () => {
  const { client } = await connectedClient()
  const response = await client.callTool({ name: 'gryps_next_step', arguments: {} })
  assert.notEqual(response.isError, true)
  const payload = response.structuredContent as {
    data: { recommended: { id: string; autonomy: string }[]; capabilityBoundary: string }
  }
  assert.equal(payload.data.recommended.length, 1)
  assert.equal(payload.data.recommended[0]?.autonomy, 'read-only')
  assert.match(payload.data.capabilityBoundary, /never trades, signs, or holds assets/)
  await client.close()
})

test('the prompt library withholds live guidance from a browsing caller', async () => {
  const { client } = await connectedClient()
  const response = await client.callTool({
    name: 'gryps_prompt_library',
    arguments: { stage: 'fund' },
  })
  const payload = response.structuredContent as {
    data: { withheld: { count: number; reason: string } }
  }
  assert.ok(payload.data.withheld.count > 0)
  assert.match(payload.data.withheld.reason, /funding station/)
  await client.close()
})

test('onboarding works with no network, because the library is embedded', async () => {
  const failingFetch: typeof fetch = async () => {
    throw new Error('no network')
  }
  const server = createPublicServer(testConfig, { fetcher: failingFetch, retryDelayMs: 0 })
  const client = new Client({ name: 'gryps-server-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

  const response = await client.callTool({ name: 'gryps_next_step', arguments: {} })
  assert.notEqual(response.isError, true, 'onboarding must survive an unreachable venue')
  await client.close()
})

test('runs a paper round trip over the wire and reports the friction lesson', async () => {
  const { client } = await connectedClient()
  const opened = await client.callTool({
    name: 'gryps_paper_session',
    arguments: { action: 'open', symbol: 'BTC', side: 'long', notionalUsd: 10_000 },
  })
  assert.notEqual(opened.isError, true)
  const openPayload = opened.structuredContent as { data: { position: { id: string } } }
  const closed = await client.callTool({
    name: 'gryps_paper_session',
    arguments: { action: 'close', positionId: openPayload.data.position.id },
  })
  assert.notEqual(closed.isError, true)
  const closePayload = closed.structuredContent as {
    data: { position: { netPnlUsd: number }; narration: string }
    meta: { limitations: string[] }
  }
  assert.equal(closePayload.data.position.netPnlUsd, -24)
  assert.match(closePayload.data.narration, /friction/i)
  assert.match(closePayload.meta.limitations.join(' '), /No order exists anywhere/)
  await client.close()
})
