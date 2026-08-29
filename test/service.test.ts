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
  assert.equal(response.data.priceStatus, 'PRICE_UNAVAILABLE')
  assert.match(response.meta.limitations.join(' '), /no current price record/i)
})

test('venue status flags the market count as unreconciled and unpublishable', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.venueStatus()
  assert.equal(response.data.catalogue.engineReportedMarketCount, 2)
  assert.equal(response.data.catalogue.reconciledWithDocumentation, false)
  assert.equal(response.data.catalogue.publishableAsClaim, false)
  assert.match(response.meta.limitations.join(' '), /must not be repeated as a public claim/)
})

test('labels fee basis and spread limitation explicitly', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.getFeeSchedule()
  assert.equal(response.data.feeBasisStatus, 'unverified_per_side_or_round_trip')
  assert.match(response.meta.limitations.join(' '), /Spread is not included/)
})

test('derives an indicative quote labeled as non-firm with an absent engine quote surface', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.indicativeQuote({ symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  assert.equal(response.data.quoteStatus, 'derived')
  assert.equal(response.data.firm, false)
  assert.equal(response.data.quoteBasis, 'derived_from_oracle_price_and_friction_model')
  assert.equal(response.data.engineQuoteSurface.status, 'absent')
  assert.equal(response.data.oracleMid?.usd, 79_620.6)
  assert.equal(response.data.estimate?.estimatedEntryPriceUsd, 79_620.6)
  assert.equal(response.data.estimate?.openLegBps, 12)
  assert.equal(response.data.estimate?.roundTripBps, 24)
  assert.equal(response.data.estimate?.breakEvenEdgeBps, 36)
  assert.equal(response.data.estimate?.openCostUsd, 12)
  assert.equal(response.data.estimate?.roundTripCostUsd, 24)
  assert.equal(response.data.provenance?.isLowerBound, true)
  assert.match(response.meta.limitations.join(' '), /cost model, not a tradable quote/)
  assert.match(response.meta.limitations.join(' '), /understates real entry cost/)
})

test('indicative quote shifts entry price only when spread is operator-measured', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
    { spreadBpsPerSide: 5 },
  )
  const response = await service.indicativeQuote({ symbol: 'BTC', side: 'short', notionalUsd: 10_000 })
  assert.equal(response.data.estimate?.estimatedEntryPriceUsd, 79_620.6 * (1 - 5 / 10_000))
  assert.equal(response.data.estimate?.openLegBps, 17)
  assert.equal(response.data.estimate?.roundTripBps, 34)
  assert.equal(response.data.provenance?.isLowerBound, false)
})

test('indicative quote reports PRICE_UNAVAILABLE instead of inventing an estimate', async () => {
  const service = new PublicReadService(
    new EngineReadClient({
      config: testConfig,
      fetcher: fixtureFetch({ '/api/v1/prices': { prices: [] } }),
    }),
  )
  const response = await service.indicativeQuote({ symbol: 'BTC', side: 'long', notionalUsd: 10_000 })
  assert.equal(response.data.quoteStatus, 'PRICE_UNAVAILABLE')
  assert.equal(response.data.estimate, null)
  assert.equal(response.data.firm, false)
  assert.match(response.meta.limitations.join(' '), /no current price record/i)
})

test('friction floor carries both readings of the unresolved fee direction', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.frictionFloor({ symbol: 'BTC' })
  assert.equal(response.data.roundTripBps, 24)
  assert.equal(response.data.breakEvenEdgeBps, 36)
  assert.equal(response.data.feeDirectionRange.resolved, false)
  assert.equal(response.data.feeDirectionRange.roundTripBpsIfPerSide, 24)
  assert.equal(response.data.feeDirectionRange.roundTripBpsIfRoundTrip, 12)
  assert.equal(response.data.feeDirectionRange.breakEvenEdgeBpsIfPerSide, 36)
  assert.equal(response.data.feeDirectionRange.breakEvenEdgeBpsIfRoundTrip, 18)
  assert.equal(response.data.provenance.spreadSurface.status, 'absent')
})

test('edge check flags a verdict that flips on the unresolved fee direction', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  // 25 bps clears the round-trip reading (18 required) but not the per-side one (36).
  const knife = await service.edgeCheck({ symbol: 'BTC', source: 'test', claimedEdgeBps: 25 })
  assert.equal(knife.data.clears, false)
  assert.equal(knife.data.feeDirectionSensitivity?.alternateClears, true)
  assert.equal(knife.data.feeDirectionSensitivity?.verdictStable, false)
  assert.match(knife.meta.limitations.join(' '), /verdict FLIPS under the other reading/)

  const clear = await service.edgeCheck({ symbol: 'BTC', source: 'test', claimedEdgeBps: 90 })
  assert.equal(clear.data.clears, true)
  assert.equal(clear.data.feeDirectionSensitivity?.verdictStable, true)
  assert.match(clear.meta.limitations.join(' '), /holds under both readings/)
})

test('edge check drops the sensitivity block once the direction is declared', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
    { feeIsRoundTrip: true },
  )
  const response = await service.edgeCheck({ symbol: 'BTC', source: 'test', claimedEdgeBps: 25 })
  assert.equal(response.data.feeDirectionSensitivity, null)
  assert.equal(response.data.clears, true)
})

test('fee schedule distinguishes unverified from declared fee direction', async () => {
  const unresolved = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const open = await unresolved.getFeeSchedule()
  assert.equal(open.data.feeBasisStatus, 'unverified_per_side_or_round_trip')
  assert.equal(open.data.feeBasisResolved, false)

  const declared = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
    { feeIsRoundTrip: false },
  )
  const closed = await declared.getFeeSchedule()
  assert.equal(closed.data.feeBasisStatus, 'declared_per_side')
  assert.equal(closed.data.feeBasisResolved, true)
})

test('venue status refuses to relay a settlement identity that misses the pin', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  // The fixture endpoint reports a contract that is not the canonical one.
  const response = await service.venueStatus()
  assert.equal(response.data.settlement.status, 'mismatch')
  assert.equal(response.data.settlement.mismatches.length, 1)
  assert.match(response.data.settlement.mismatches[0] ?? '', /does not match the canonical/)
  assert.match(response.meta.limitations.join(' '), /SETTLEMENT IDENTITY MISMATCH/)
})

test('venue status verifies a settlement identity that matches the pin', async () => {
  const service = new PublicReadService(
    new EngineReadClient({
      config: testConfig,
      fetcher: fixtureFetch({
        '/api/v1/config': {
          chainId: 137,
          contractAddress: '0xc206b7725e6e6631516b4fea100f8a07bbc736ee',
          usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        },
      }),
    }),
  )
  const response = await service.venueStatus()
  // Case must not decide identity: the same address in either case is the same address.
  assert.equal(response.data.settlement.status, 'verified')
  assert.deepEqual(response.data.settlement.mismatches, [])
  assert.doesNotMatch(response.meta.limitations.join(' '), /SETTLEMENT IDENTITY/)
})

test('resolves a common name through the alias table and reports the route', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.getMarket({ symbol: 'bitcoin' })
  assert.equal(response.data.market.symbol, 'BTCUSDT')
  assert.equal(response.data.resolution.aliasApplied, 'BTC')
  assert.equal(response.data.resolution.via, 'base-asset')
  assert.match(response.meta.limitations.join(' '), /resolved through the curated alias table/)
})

test('an exact symbol resolves without an alias', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.getMarket({ symbol: 'BTCUSDT' })
  assert.equal(response.data.resolution.aliasApplied, null)
  assert.equal(response.data.resolution.via, 'symbol')
  assert.doesNotMatch(response.meta.limitations.join(' '), /alias table/)
})

test('a failed resolution names the nearest listed symbols instead of just failing', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  await assert.rejects(
    () => service.getMarket({ symbol: 'BTCUSD' }),
    (error: unknown) =>
      error instanceof PublicMcpError &&
      error.code === 'not_found' &&
      /Closest listed symbols: BTCUSDT/.test(error.message),
  )
})

test('an ambiguous base asset names the markets it matched', async () => {
  const service = new PublicReadService(
    new EngineReadClient({
      config: testConfig,
      fetcher: fixtureFetch({
        '/api/v1/markets': {
          markets: [
            { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', displayName: 'BTC/USDT', pricePrecision: 2, quantityPrecision: 3 },
            { symbol: 'BTCUSDC', baseAsset: 'BTC', quoteAsset: 'USDC', displayName: 'BTC/USDC', pricePrecision: 2, quantityPrecision: 3 },
          ],
        },
      }),
    }),
  )
  await assert.rejects(
    () => service.getMarket({ symbol: 'bitcoin' }),
    (error: unknown) =>
      error instanceof PublicMcpError &&
      error.code === 'ambiguous_symbol' &&
      /BTCUSDT, BTCUSDC/.test(error.message),
  )
})

test('browsing by a common name finds the market instead of returning nothing', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  // This is the search that used to return zero results.
  const response = await service.listMarkets({ query: 'bitcoin', limit: 50, offset: 0 })
  // PUMPBTCUSDT contains BTC too, so it is a hit — but the market the caller
  // meant has to come first.
  assert.equal(response.data.total, 2)
  assert.equal(response.data.markets[0]?.symbol, 'BTCUSDT')
  assert.equal(response.data.query?.matchMode, 'alias')
  assert.equal(response.data.query?.aliasApplied, 'BTC')
  assert.match(response.meta.limitations.join(' '), /was read as "BTC" from the curated alias table/)
})

test('browsing a near miss returns ranked suggestions labelled as guesses', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  // BTCUSD is a substring of BTCUSDT, so it matches outright; BTCUSDX does not.
  const response = await service.listMarkets({ query: 'BTCUSDX', limit: 50, offset: 0 })
  assert.equal(response.data.query?.matchMode, 'nearest')
  assert.equal(response.data.markets[0]?.symbol, 'BTCUSDT')
  assert.match(response.meta.limitations.join(' '), /nearest listed symbols by name similarity, not matches/)
})

test('browsing something genuinely absent says so rather than guessing', async () => {
  const service = new PublicReadService(
    new EngineReadClient({ config: testConfig, fetcher: fixtureFetch() }),
  )
  const response = await service.listMarkets({ query: 'toncoin', limit: 50, offset: 0 })
  assert.equal(response.data.total, 0)
  assert.equal(response.data.query?.matchMode, 'none')
  assert.match(response.meta.limitations.join(' '), /probably not listed/)
})
