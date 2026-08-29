import assert from 'node:assert/strict'
import test from 'node:test'
import {
  breakEvenEdgeBps,
  checkEdge,
  combineSignals,
  structuralCorrelation,
  type StackedSignal,
} from '../src/analysis.js'
import { PublicMcpError } from '../src/errors.js'
import type { FrictionQuote } from '../src/friction.js'

const friction: FrictionQuote = {
  venueId: 'gryps-v2',
  symbol: 'BTCUSDT',
  openSpreadBps: 0,
  closeSpreadBps: 0,
  protocolFeeBps: 24,
  roundTripBps: 24,
  measuredAtIso: '2026-08-28T12:00:00.000Z',
}

test('refuses a claimed edge that cannot pay for its own execution', () => {
  const result = checkEdge({ symbol: 'BTCUSDT', source: 'test', claimedEdgeBps: 10 }, friction)
  assert.equal(result.clears, false)
  assert.ok(result.edgeToFrictionRatio < 1)
  assert.match(result.verdict, /DOES NOT CLEAR/)
  assert.match(result.caveats.join(' '), /losing trade|smaller than the cost/i)
})

test('clears an edge that beats friction with margin', () => {
  const result = checkEdge({ symbol: 'BTCUSDT', source: 'test', claimedEdgeBps: 200 }, friction)
  assert.equal(result.clears, true)
  assert.equal(result.requiredEdgeBps, 36)
  assert.match(result.verdict, /CLEARS/)
})

test('low confidence widens the required edge', () => {
  const confident = checkEdge({ symbol: 'BTCUSDT', source: 't', claimedEdgeBps: 50 }, friction)
  const unsure = checkEdge(
    { symbol: 'BTCUSDT', source: 't', claimedEdgeBps: 50, confidence: 0 },
    friction,
  )
  assert.ok(unsure.requiredEdgeBps > confident.requiredEdgeBps)
  assert.equal(unsure.requiredEdgeBps, confident.requiredEdgeBps * 2)
})

test('a repeated signal pays friction on every round trip', () => {
  const once = checkEdge({ symbol: 'BTCUSDT', source: 't', claimedEdgeBps: 100 }, friction)
  const tenTimes = checkEdge(
    { symbol: 'BTCUSDT', source: 't', claimedEdgeBps: 100, expectedRoundTrips: 10 },
    friction,
  )
  assert.equal(tenTimes.liveFrictionBps, once.liveFrictionBps * 10)
  assert.equal(tenTimes.clears, false)
})

test('break-even edge matches the required edge at default settings', () => {
  const result = checkEdge({ symbol: 'BTCUSDT', source: 't', claimedEdgeBps: 0 }, friction)
  assert.equal(breakEvenEdgeBps(friction), result.requiredEdgeBps)
})

test('same-family signals are never treated as independent confirmations', () => {
  const signals: StackedSignal[] = [
    { source: 'feed A', family: 'social', claimedEdgeBps: 40 },
    { source: 'feed B', family: 'social', claimedEdgeBps: 40 },
    { source: 'feed C', family: 'social', claimedEdgeBps: 40 },
  ]
  const result = combineSignals(signals)
  assert.equal(structuralCorrelation(signals), 1)
  assert.equal(result.effectiveEdgeBps, 40)
  assert.equal(result.naiveSumBps, 120)
  assert.equal(result.overstatementFactor, 3)
  assert.match(result.warnings.join(' '), /one signal wearing 3 hats/)
})

test('a caller cannot declare independence the source families do not have', () => {
  const result = combineSignals(
    [
      { source: 'x', family: 'social', claimedEdgeBps: 30 },
      { source: 'y', family: 'news', claimedEdgeBps: 30 },
    ],
    { assumedCorrelation: 0 },
  )
  assert.equal(result.correlationUsed, 0.7)
  assert.match(result.warnings.join(' '), /was raised to 0.70/)
})

test('genuinely diverse sources combine in quadrature, never naively', () => {
  const result = combineSignals([
    { source: 'ta', family: 'technical', claimedEdgeBps: 60 },
    { source: 'chain', family: 'onchain', claimedEdgeBps: 60 },
  ])
  assert.ok(result.effectiveEdgeBps > result.largestSingleBps)
  assert.ok(result.effectiveEdgeBps < result.naiveSumBps)
})

test('an empty signal stack is refused rather than defaulted', () => {
  assert.throws(
    () => combineSignals([]),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'invalid_configuration',
  )
})

test('folds a repeated source into one signal instead of counting it twice', () => {
  const result = combineSignals([
    { source: 'Teneo sentiment', family: 'social', claimedEdgeBps: 40 },
    { source: 'Teneo sentiment', family: 'social', claimedEdgeBps: 35 },
    { source: 'orderflow', family: 'onchain', claimedEdgeBps: 30 },
  ])
  assert.equal(result.suppliedSignalCount, 3)
  assert.equal(result.independentSignalCount, 2)
  assert.equal(result.echoesCollapsed.length, 1)
  assert.equal(result.echoesCollapsed[0]?.echoOf, 'Teneo sentiment')
  // The larger claim survives the fold, so nothing is understated.
  assert.equal(result.largestSingleBps, 40)
  assert.match(result.warnings.join(' '), /were echoes of another entry/)
})

test('a shared originId folds sources whose labels look nothing alike', () => {
  const result = combineSignals([
    { source: 'CryptoNewsWire', family: 'news', claimedEdgeBps: 50, originId: 'reuters-btc-etf' },
    { source: 'Anon TG channel', family: 'social', claimedEdgeBps: 45, originId: 'reuters-btc-etf' },
  ])
  assert.equal(result.independentSignalCount, 1)
  assert.equal(result.echoesCollapsed[0]?.source, 'Anon TG channel')
  // One story relayed twice cannot beat the strongest single claim.
  assert.equal(result.effectiveEdgeBps, 50)
})

test('near-identical source names are treated as one feed without being folded', () => {
  const result = combineSignals([
    { source: 'Teneo sentiment', family: 'social', claimedEdgeBps: 40 },
    { source: 'Teneo sentiment v2', family: 'technical', claimedEdgeBps: 40 },
  ])
  assert.equal(result.independentSignalCount, 2)
  assert.equal(result.suspectedEchoes.length, 1)
  // Family priors alone would have said 0.2 here.
  assert.equal(result.correlationUsed, 0.9)
  assert.match(result.warnings.join(' '), /name what looks like the same feed/)
})

test('short distinct source labels are not mistaken for echoes', () => {
  const result = combineSignals([
    { source: 'RSI', family: 'technical', claimedEdgeBps: 40 },
    { source: 'RS1', family: 'onchain', claimedEdgeBps: 40 },
  ])
  assert.equal(result.suspectedEchoes.length, 0)
  assert.equal(result.independentSignalCount, 2)
})

test('the naive sum still counts every supplied signal, echoes included', () => {
  const result = combineSignals([
    { source: 'feed', family: 'social', claimedEdgeBps: 30 },
    { source: 'feed', family: 'social', claimedEdgeBps: 30 },
    { source: 'feed', family: 'social', claimedEdgeBps: 30 },
  ])
  // Naive stacking would have called this 90 bps of edge. It is 30.
  assert.equal(result.naiveSumBps, 90)
  assert.equal(result.effectiveEdgeBps, 30)
  assert.equal(result.overstatementFactor, 3)
  assert.equal(result.independentSignalCount, 1)
})
