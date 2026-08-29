import assert from 'node:assert/strict'
import test from 'node:test'
import { PublicMcpError } from '../src/errors.js'
import { bracketFor, checkSurvival, decodeBrackets, marginProfile } from '../src/margin.js'
import { sizePosition } from '../src/sizing.js'
import { allInCostBps, fundingCost } from '../src/funding.js'
import type { MarketDataRecord, SymbolRisk } from '../src/schemas.js'

// A two-bracket ladder in the engine's own 1e6 fixed point: 5k notional at
// 100 bps maintenance, then 20k at 200 bps with the offset that keeps the
// ladder continuous at the boundary.
const risk: SymbolRisk = {
  defaultLeverage: 20,
  maxLeverage: 75,
  mmBrackets: [
    { maxNotional: '5000000000', mmrBps: 100, cum: '0', maxLeverage: 75 },
    { maxNotional: '20000000000', mmrBps: 200, cum: '50000000', maxLeverage: 25 },
  ],
}

const funding: MarketDataRecord = {
  symbol: 'BTCUSDT',
  fundingRate: '0.00010000',
  nextFundingTime: 1_787_961_600_000,
  updatedAt: 1_787_956_629_000,
}

/* --------------------------------- margin --------------------------------- */

test('decodes brackets out of the engine fixed point', () => {
  const brackets = decodeBrackets(risk.mmBrackets)
  assert.equal(brackets[0]?.maxNotionalUsd, 5_000)
  assert.equal(brackets[1]?.maxNotionalUsd, 20_000)
  assert.equal(brackets[1]?.cumulativeOffsetUsd, 50)
})

test('the ladder is continuous at the bracket boundary', () => {
  const brackets = decodeBrackets(risk.mmBrackets)
  // At the boundary both brackets must charge the same maintenance margin,
  // which is the whole point of the cumulative offset.
  const atBoundaryLower = (5_000 * 100) / 10_000
  const atBoundaryUpper = (5_000 * 200) / 10_000 - 50
  assert.equal(atBoundaryLower, atBoundaryUpper)
  assert.equal(bracketFor(brackets, 5_000).maintenanceMarginRateBps, 100)
  assert.equal(bracketFor(brackets, 5_001).maintenanceMarginRateBps, 200)
})

test('computes the liquidation buffer for a position', () => {
  const profile = marginProfile({ risk, notionalUsd: 1_000, side: 'long', leverage: 20, entryPriceUsd: 100 })
  assert.equal(profile.initialMarginUsd, 50)
  assert.equal(profile.maintenanceMarginUsd, 10)
  assert.equal(profile.bufferUsd, 40)
  assert.equal(profile.liquidationDistanceBps, 400)
  assert.equal(profile.liquidationPriceUsd, 96)
})

test('a short liquidates upward, not downward', () => {
  const profile = marginProfile({ risk, notionalUsd: 1_000, side: 'short', leverage: 20, entryPriceUsd: 100 })
  assert.equal(profile.liquidationPriceUsd, 104)
})

test('clamps leverage the bracket does not allow, and says so', () => {
  const profile = marginProfile({ risk, notionalUsd: 10_000, side: 'long', leverage: 75 })
  assert.equal(profile.bracket.maxNotionalUsd, 20_000)
  assert.equal(profile.effectiveLeverage, 25)
  assert.equal(profile.leverageWasClamped, true)
  assert.match(profile.notes.join(' '), /not available at this size/)
})

test('refuses a size the venue publishes no margin terms for', () => {
  assert.throws(
    () => marginProfile({ risk, notionalUsd: 25_000, side: 'long' }),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'invalid_request',
  )
})

test('names a position that is liquidated before its own thesis arrives', () => {
  // 75x on the first bracket leaves 33.3 bps of room, and friction eats 24.
  const profile = marginProfile({ risk, notionalUsd: 1_000, side: 'long', leverage: 75 })
  const survival = checkSurvival(profile, 50, 24)
  assert.equal(survival.edgeReachable, false)
  assert.ok(survival.survivableAdverseMoveBps < 50)
  assert.match(survival.verdict, /Fragile/)

  const roomy = marginProfile({ risk, notionalUsd: 1_000, side: 'long', leverage: 5 })
  assert.equal(checkSurvival(roomy, 50, 24).edgeReachable, true)
})

/* --------------------------------- sizing --------------------------------- */

test('refuses to size a trade that fails the cost gate', () => {
  const result = sizePosition({ risk, claimedEdgeBps: 15, frictionBps: 24, accountEquityUsd: 100_000 })
  assert.equal(result.viable, false)
  assert.equal(result.bindingConstraint, 'edge-does-not-clear-friction')
  assert.equal(result.best, null)
  assert.match(result.narration, /No size is correct/)
})

test('returns the largest size every constraint allows, and names the binding one', () => {
  const result = sizePosition({ risk, claimedEdgeBps: 80, frictionBps: 24, accountEquityUsd: 100_000 })
  assert.equal(result.viable, true)
  // 1% of 100k is 1k of margin; the venue's ladder stops at 20k notional.
  assert.equal(result.riskBudgetUsd, 1_000)
  assert.equal(result.bindingConstraint, 'venue-bracket-ceiling')
  assert.equal(result.best?.notionalUsd, 20_000)
  assert.ok((result.best?.survivableAdverseMoveBps ?? 0) > 80)
})

test('a smaller account is bound by its own budget, not by the venue', () => {
  const result = sizePosition({ risk, claimedEdgeBps: 80, frictionBps: 24, accountEquityUsd: 1_000 })
  assert.equal(result.viable, true)
  assert.ok((result.best?.notionalUsd ?? 0) < result.venueMaxNotionalUsd)
  assert.equal(result.best?.initialMarginUsd, 10)
})

test('reports no size when nothing survives the required buffer', () => {
  const result = sizePosition({
    risk,
    claimedEdgeBps: 500,
    frictionBps: 24,
    accountEquityUsd: 100_000,
    safetyMultiple: 20,
  })
  assert.equal(result.viable, false)
  assert.equal(result.bindingConstraint, 'survivability')
  assert.match(result.warnings.join(' '), /rejected on survivability/)
})

/* -------------------------------- funding --------------------------------- */

test('funding is a transfer: one side pays exactly what the other receives', () => {
  const long = fundingCost({ record: funding, side: 'long', notionalUsd: 100_000, holdHours: 24 })
  const short = fundingCost({ record: funding, side: 'short', notionalUsd: 100_000, holdHours: 24 })
  assert.equal(long.ratePerEventBps, 1)
  assert.equal(long.paysFunding, true)
  assert.equal(short.paysFunding, false)
  assert.equal(long.costPerEventBps, -short.costPerEventBps)
  assert.equal(long.costPerEventUsd, 10)
})

test('reports the hold cost across every plausible interval while the interval is unknown', () => {
  const cost = fundingCost({ record: funding, side: 'long', notionalUsd: 100_000, holdHours: 24 })
  assert.equal(cost.intervalResolved, false)
  assert.deepEqual(
    cost.byInterval.map((row) => [row.intervalHours, row.events, row.costBps]),
    [
      [1, 24, 24],
      [4, 6, 6],
      [8, 3, 3],
    ],
  )
  assert.match(cost.notes.join(' '), /also sits on the four-hour and one-hour grids/)
})

test('uses a confirmed interval when one is supplied', () => {
  const cost = fundingCost({
    record: funding,
    side: 'long',
    notionalUsd: 100_000,
    holdHours: 24,
    intervalHours: 8,
  })
  assert.equal(cost.intervalResolved, true)
  const allIn = allInCostBps(cost, 24)
  assert.equal(allIn.carryBasis, 'confirmed-interval')
  assert.equal(allIn.carryBps, 3)
  assert.equal(allIn.allInBps, 27)
})

test('an unconfirmed interval takes the most expensive candidate', () => {
  const cost = fundingCost({ record: funding, side: 'long', notionalUsd: 100_000, holdHours: 24 })
  const allIn = allInCostBps(cost, 24)
  assert.equal(allIn.carryBasis, 'worst-candidate')
  assert.equal(allIn.carryBps, 24)
  assert.equal(allIn.allInBps, 48)
})

test('the conservative reading for a receiving side is the least it receives', () => {
  const cost = fundingCost({ record: funding, side: 'short', notionalUsd: 100_000, holdHours: 24 })
  const allIn = allInCostBps(cost, 24)
  // Worst case for a short earning funding is earning as little as possible.
  assert.equal(allIn.carryBps, -3)
  assert.equal(allIn.allInBps, 21)
})

test('carry over a long hold can dwarf the round trip being gated on', () => {
  const week = fundingCost({ record: funding, side: 'long', notionalUsd: 100_000, holdHours: 168 })
  const allIn = allInCostBps(week, 24)
  assert.equal(allIn.carryBps, 168)
  assert.ok(allIn.carryBps > 24 * 5)
})
