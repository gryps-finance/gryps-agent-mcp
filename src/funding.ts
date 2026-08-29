/**
 * Funding carry: the cost of holding, as opposed to the cost of entering.
 *
 * Friction is charged twice, at the open and the close, and then it is done.
 * Funding is charged for as long as the position exists, and for any hold of
 * more than a few hours it can exceed the round trip that this package has been
 * gating on. A signal with a one-day horizon was being priced as if holding
 * were free.
 *
 * The engine publishes the rate but not the interval it is charged over, which
 * is the same shape of gap as the fee-direction question. It is handled the
 * same way: the exact per-event cost is reported with no assumption, and the
 * hold cost is reported across the intervals still consistent with what was
 * observed.
 *
 * Those candidates are derived, not guessed. A funding stamp rules an interval
 * out in two ways: the stamp must sit on that interval's grid, and the previous
 * stamp on that grid must already have passed, or the engine would be
 * advertising it instead. That narrows the set on every call without assuming a
 * convention.
 *
 * The interval is per market. Measured on 2026-08-29, COTIUSDT and ONGUSDT
 * rolled 22:00 to 23:00 UTC, one hour apart, while 699 other markets stamped at
 * 00:00 and did not roll at 22:00 at all. Any single venue-wide assumption
 * would have been wrong for one cohort or the other.
 */

import { PublicMcpError } from './errors.js'
import type { MarketDataRecord } from './schemas.js'

/** Intervals that divide a day evenly, which is what funding grids are built on. */
export const CANDIDATE_FUNDING_INTERVALS_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const

const HOUR_MS = 3_600_000

/**
 * Intervals still consistent with one observed funding stamp.
 *
 * An interval survives only if the advertised stamp sits on its grid and the
 * previous stamp on that grid has already gone by. A market advertising 23:00
 * at 22:02 can only be hourly; one advertising 00:00 at 22:02 cannot be hourly,
 * because 23:00 would have been advertised instead.
 */
export function consistentIntervalsHours(nextFundingTimeMs: number, observedAtMs: number): number[] {
  return CANDIDATE_FUNDING_INTERVALS_HOURS.filter((hours) => {
    const period = hours * HOUR_MS
    // Grids are anchored at the UTC epoch, which is also UTC midnight.
    if (nextFundingTimeMs % period !== 0) return false
    return nextFundingTimeMs - period <= observedAtMs
  })
}

export interface FundingEventCost {
  intervalHours: number
  events: number
  costBps: number
  costUsd: number
}

export interface FundingCost {
  /** Intervals not ruled out by the observed stamp. */
  candidateIntervalsHours: number[]
  symbol: string
  side: 'long' | 'short'
  notionalUsd: number
  holdHours: number
  /** As published, per funding event, signed from the long's perspective. */
  fundingRate: number
  ratePerEventBps: number
  /** Signed for the side held: positive means this side pays. */
  costPerEventBps: number
  costPerEventUsd: number
  paysFunding: boolean
  nextFundingAtIso: string
  intervalResolved: boolean
  intervalHoursUsed: number | null
  byInterval: FundingEventCost[]
  observedAtIso: string
  notes: string[]
}

export interface FundingInput {
  record: MarketDataRecord
  side: 'long' | 'short'
  notionalUsd: number
  holdHours: number
  /** Supply once the venue confirms how often funding is charged. */
  intervalHours?: number | undefined
}

export function fundingCost(input: FundingInput): FundingCost {
  const { record, side, notionalUsd, holdHours } = input
  if (!(notionalUsd > 0)) {
    throw new PublicMcpError('invalid_request', 'Notional must be greater than zero.')
  }
  if (!(holdHours >= 0)) {
    throw new PublicMcpError('invalid_request', 'Hold duration must not be negative.')
  }

  const fundingRate = Number(record.fundingRate)
  if (!Number.isFinite(fundingRate)) {
    throw new PublicMcpError(
      'upstream_schema_mismatch',
      `The engine returned a funding rate for ${record.symbol} that is not a number.`,
    )
  }

  // A positive rate is paid by longs to shorts. The short is on the other side
  // of the same transfer, so it earns exactly what the long pays.
  const ratePerEventBps = fundingRate * 10_000
  const costPerEventBps = side === 'long' ? ratePerEventBps : -ratePerEventBps
  const costPerEventUsd = (notionalUsd * costPerEventBps) / 10_000

  const candidateIntervalsHours = consistentIntervalsHours(record.nextFundingTime, record.updatedAt)
  const intervals = input.intervalHours !== undefined ? [input.intervalHours] : candidateIntervalsHours
  const byInterval = intervals.map((intervalHours) => {
    // A position is charged at each funding stamp it is open across.
    const events = Math.ceil(holdHours / intervalHours)
    return {
      intervalHours,
      events,
      costBps: costPerEventBps * events,
      costUsd: costPerEventUsd * events,
    }
  })

  const intervalResolved = input.intervalHours !== undefined
  const intervalHoursUsed = input.intervalHours ?? null

  const notes: string[] = [
    'Funding is a transfer between traders, not a venue fee. A negative cost here is funding received, not a discount.',
    'The rate shown is the one currently published. It is reset every funding period and is not a forecast of what later periods will charge.',
  ]
  if (intervalResolved) {
    notes.push(`Funding interval of ${intervalHoursUsed} hours was supplied by configuration, not read from the engine.`)
  } else if (candidateIntervalsHours.length === 1) {
    notes.push(
      `The advertised funding stamp is consistent with only one interval, ${candidateIntervalsHours[0]} hours, so the hold cost above is determined rather than bracketed.`,
    )
  } else {
    notes.push(
      `The engine publishes the funding rate but not the interval it is charged over. The advertised stamp rules out every interval except ${candidateIntervalsHours.join(', ')} hours, and the hold cost is reported across those. Confirm the interval with the venue before treating any single row as the cost.`,
    )
  }
  notes.push(
    'Funding intervals differ between markets on this venue. Measured on 2026-08-29, two markets funded hourly while 699 others did not stamp on the hour at all, so an interval confirmed for one market must not be assumed for another.',
  )

  return {
    candidateIntervalsHours,
    symbol: record.symbol,
    side,
    notionalUsd,
    holdHours,
    fundingRate,
    ratePerEventBps,
    costPerEventBps,
    costPerEventUsd,
    paysFunding: costPerEventBps > 0,
    nextFundingAtIso: new Date(record.nextFundingTime).toISOString(),
    intervalResolved,
    intervalHoursUsed,
    byInterval,
    observedAtIso: new Date(record.updatedAt).toISOString(),
    notes,
  }
}

/**
 * Carry added to round-trip friction, so a hold can be gated on its all-in
 * cost rather than its entry cost. Without a confirmed interval this returns
 * the most expensive candidate still consistent with the observed stamp, which
 * is the conservative reading and matches how this package already treats the
 * unresolved fee direction.
 */
export function allInCostBps(
  friction: FundingCost,
  roundTripFrictionBps: number,
): { carryBps: number; allInBps: number; carryBasis: 'confirmed-interval' | 'worst-candidate' } {
  if (friction.intervalResolved && friction.intervalHoursUsed !== null) {
    const events = Math.ceil(friction.holdHours / friction.intervalHoursUsed)
    const carryBps = friction.costPerEventBps * events
    return { carryBps, allInBps: roundTripFrictionBps + carryBps, carryBasis: 'confirmed-interval' }
  }
  const costs = friction.byInterval.map((row) => row.costBps)
  if (costs.length === 0) {
    return { carryBps: 0, allInBps: roundTripFrictionBps, carryBasis: 'worst-candidate' }
  }
  const carryBps = Math.max(...costs)
  return { carryBps, allInBps: roundTripFrictionBps + carryBps, carryBasis: 'worst-candidate' }
}
