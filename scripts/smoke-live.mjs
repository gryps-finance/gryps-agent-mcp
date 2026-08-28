import assert from 'node:assert/strict'
import { defaultConfig } from '../dist/config.js'
import { EngineReadClient } from '../dist/client.js'
import { PublicReadService } from '../dist/service.js'

const config = defaultConfig()
const service = new PublicReadService(new EngineReadClient({ config }), {
  comparisonUrl: config.comparisonUrl,
  comparisonTakerFeeBps: config.comparisonTakerFeeBps,
  feeIsRoundTrip: config.feeIsRoundTrip,
  spreadBpsPerSide: config.spreadBpsPerSide,
  timeoutMs: config.timeoutMs,
})

const [status, btc, fees, floor] = await Promise.all([
  service.venueStatus(),
  service.getMarket({ symbol: 'BTC' }),
  service.getFeeSchedule(),
  service.frictionFloor({ symbol: 'BTC' }),
])

assert.equal(status.status, 'ok')
assert.equal(status.data.service.status, 'healthy')
assert.ok(status.data.catalogue.engineReportedMarketCount > 0)
assert.equal(status.data.catalogue.publishableAsClaim, false)
assert.equal(btc.data.market.symbol, 'BTCUSDT')
assert.ok((btc.data.price?.usd ?? 0) > 0)
assert.ok(fees.data.tiers.length > 0)

assert.ok(floor.data.roundTripBps > 0, 'friction floor must be a positive live number')
assert.equal(floor.data.provenance.feeBasis, 'engine-reported')
assert.equal(floor.data.provenance.isLowerBound, true, 'spread is unmeasured, so this must report a lower bound')

// A claim below the live floor must be refused. This is the product promise.
const losing = await service.edgeCheck({ symbol: 'BTC', source: 'live smoke', claimedEdgeBps: 1 })
assert.equal(losing.data.clears, false, 'a 1 bps claim must never clear a positive friction floor')

// Correlated sources must not be counted as independent confirmations.
const stack = await service.signalStack({
  signals: [
    { source: 'sentiment', family: 'social', claimedEdgeBps: 40 },
    { source: 'headline', family: 'news', claimedEdgeBps: 40 },
  ],
  symbol: 'BTC',
})
assert.ok(
  stack.data.effectiveEdgeBps < stack.data.naiveSumBps,
  'stacked correlated signals must combine to less than their naive sum',
)

const route = await service.routeCompare({ symbol: 'BTC', side: 'long', notionalUsd: 250_000 })
assert.equal(route.status, 'ok')
assert.equal(route.data.venues.length, 2)

process.stdout.write(
  [
    `Live smoke passed.`,
    `  venue: ${status.data.service.version}, ${status.data.catalogue.engineReportedMarketCount} engine-reported markets (unreconciled)`,
    `  ${btc.data.market.symbol}: ${btc.data.price.usd} USD`,
    `  friction floor: ${floor.data.roundTripBps} bps round trip (lower bound), break-even edge ${floor.data.breakEvenEdgeBps.toFixed(1)} bps`,
    `  signal stack: naive ${stack.data.naiveSumBps} bps reduced to ${stack.data.effectiveEdgeBps.toFixed(1)} bps (${stack.data.overstatementFactor.toFixed(2)}x overstatement caught)`,
    `  route compare $250k BTC: cheapest = ${route.data.cheapest ?? 'none'}${
      route.data.spreadBetweenVenuesBps === null
        ? ''
        : ` by ${route.data.spreadBetweenVenuesBps.toFixed(1)} bps`
    }`,
    '',
  ].join('\n'),
)
