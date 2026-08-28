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

test('reports ambiguity when one base asset lists on multiple quote markets', () => {
  const twoQuotes = [
    ...markets,
    {
      symbol: 'BTCUSDC',
      baseAsset: 'BTC',
      quoteAsset: 'USDC',
      displayName: 'BTC/USDC',
      pricePrecision: 2,
      quantityPrecision: 3,
    },
  ]
  assert.throws(
    () => resolveMarket(twoQuotes, 'BTC'),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'ambiguous_symbol',
  )
})

test('filters and paginates the market catalogue deterministically', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const first = await service.listMarkets({ limit: 1, offset: 0 })
  assert.equal(first.data.total, 2)
  assert.equal(first.data.markets.length, 1)
  assert.equal(first.data.markets[0]?.symbol, 'BTCUSDT')

  const second = await service.listMarkets({ limit: 1, offset: 1 })
  assert.equal(second.data.markets[0]?.symbol, 'PUMPBTCUSDT')

  const filtered = await service.listMarkets({ query: 'pump', limit: 50, offset: 0 })
  assert.equal(filtered.data.total, 1)
  assert.equal(filtered.data.markets[0]?.symbol, 'PUMPBTCUSDT')
})

test('states the limitation when no price record exists for a market', async () => {
  const service = new PublicReadService(
    new EngineReadClient({
      config: testConfig,
      fetcher: fixtureFetch({ '/api/v1/prices': { prices: [] } }),
    }),
  )
  const response = await service.getMarket({ symbol: 'BTC' })
  assert.equal(response.data.price, null)
  assert.match(response.meta.limitations.join(' '), /No current price record/)
})

test('labels fee basis and spread limitation explicitly', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.getFeeSchedule()
  assert.equal(response.data.feeBasisStatus, 'unverified_per_side_or_round_trip')
  assert.match(response.meta.limitations.join(' '), /Spread is not included/)
})
