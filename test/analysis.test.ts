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
