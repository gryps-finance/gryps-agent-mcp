import assert from 'node:assert/strict'
import test from 'node:test'
import { EngineReadClient } from '../src/client.js'
import { MAX_UPSTREAM_RESPONSE_BYTES } from '../src/constants.js'
import { PublicMcpError } from '../src/errors.js'
import { fixtureFetch, testConfig } from './fixtures.js'

test('parses wrapped v2 market and price responses', async () => {
  const client = new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() })
  const [markets, prices] = await Promise.all([client.markets(), client.prices()])
  assert.equal(markets.length, 2)
  assert.equal(markets[0]?.symbol, 'BTCUSDT')
  assert.equal(prices[0]?.price, '79620600000')
})

test('caches identical endpoint reads for the configured TTL', async () => {
  let calls = 0
  const base = fixtureFetch()
  const fetcher: typeof fetch = async (input, init) => {
    calls += 1
    return base(input, init)
  }
  const client = new EngineReadClient({ config: testConfig, fetcher, nowMs: () => 1_000 })
  await client.markets()
  await client.markets()
  assert.equal(calls, 1)
})

test('returns a sanitised availability error', async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error('secret internal network detail')
  }
  const client = new EngineReadClient({ config: testConfig, fetcher, retryDelayMs: 0 })
  await assert.rejects(
    () => client.markets(),
    (error: unknown) =>
      error instanceof PublicMcpError &&
      error.code === 'upstream_unavailable' &&
      !error.message.includes('secret'),
  )
})

test('retries one transient upstream failure before succeeding', async () => {
  let calls = 0
  const base = fixtureFetch()
  const fetcher: typeof fetch = async (input, init) => {
    calls += 1
    if (calls === 1) return new Response('upstream busy', { status: 503 })
    return base(input, init)
  }
  const client = new EngineReadClient({ config: testConfig, fetcher, retryDelayMs: 0 })
  const markets = await client.markets()
  assert.equal(markets.length, 2)
  assert.equal(calls, 2)
})

test('does not retry a non-retryable upstream status', async () => {
  let calls = 0
  const fetcher: typeof fetch = async () => {
    calls += 1
    return new Response('missing', { status: 404 })
  }
  const client = new EngineReadClient({ config: testConfig, fetcher, retryDelayMs: 0 })
  await assert.rejects(
    () => client.markets(),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'upstream_unavailable',
  )
  assert.equal(calls, 1)
})

test('rejects an oversized upstream response body', async () => {
  const oversized = `{"filler":"${'x'.repeat(MAX_UPSTREAM_RESPONSE_BYTES)}"}`
  const fetcher: typeof fetch = async () => new Response(oversized, { status: 200 })
  const client = new EngineReadClient({ config: testConfig, fetcher, retryDelayMs: 0 })
  await assert.rejects(
    () => client.markets(),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'upstream_schema_mismatch',
  )
})
