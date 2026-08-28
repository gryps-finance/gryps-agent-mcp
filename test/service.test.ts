import assert from 'node:assert/strict'
import test from 'node:test'
import { EngineReadClient } from '../src/client.js'
import { PublicMcpError } from '../src/errors.js'
import { PublicReadService, resolveMarket } from '../src/service.js'
import { fixtureBodies, fixtureFetch, testConfig } from './fixtures.js'
import { marketsResponseSchema } from '../src/schemas.js'

const parsedMarkets = marketsResponseSchema.parse(fixtureBodies['/api/v1/markets'])
const markets = Array.isArray(parsedMarkets) ? parsedMarkets : parsedMarkets.markets

test('resolves BTC to BTCUSDT without matching PUMPBTCUSDT', () => {
  assert.equal(resolveMarket(markets, 'BTC').symbol, 'BTCUSDT')
  assert.equal(resolveMarket(markets, 'btc/usdt').symbol, 'BTCUSDT')
})

test('refuses substring symbol guessing', () => {
  assert.throws(
    () => resolveMarket(markets, 'PUMP'),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'not_found',
  )
})

test('returns a typed market envelope with decoded price and risk', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.getMarket({ symbol: 'BTC' })
  assert.equal(response.schemaVersion, '1.0')
  assert.equal(response.status, 'ok')
  assert.equal(response.data.market.symbol, 'BTCUSDT')
  assert.equal(response.data.price?.usd, 79_620.6)
  assert.equal(response.data.risk?.maxLeverage, 75)
  assert.equal(response.meta.readOnly, true)
})

test('labels fee basis and spread limitation explicitly', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.getFeeSchedule()
  assert.equal(response.data.feeBasisStatus, 'unverified_per_side_or_round_trip')
  assert.match(response.meta.limitations.join(' '), /Spread is not included/)
})
