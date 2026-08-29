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
 * hold cost is reported across the plausible intervals until the interval is
 * confirmed. One observation cannot settle it, because a timestamp on an
 * eight-hour grid also sits on the four-hour and one-hour grids.
 */

import { PublicMcpError } from './errors.js'
import type { MarketDataRecord } from './schemas.js'

/** Intervals in hours that perpetual venues actually use. */
export const CANDIDATE_FUNDING_INTERVALS_HOURS = [1, 4, 8] as const

export interface FundingEventCost {
  intervalHours: number
  events: number
  costBps: number
  costUsd: number
}

export interface FundingCost {
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

  const byInterval = CANDIDATE_FUNDING_INTERVALS_HOURS.map((intervalHours) => {
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
  } else {
    notes.push(
      'The engine publishes the funding rate but not the interval it is charged over, so the hold cost is reported across the intervals venues actually use. One timestamp cannot settle this: a stamp on an eight-hour grid also sits on the four-hour and one-hour grids. Confirm the interval with the venue before treating any single row as the cost.',
    )
  }

  return {
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
 * the most expensive candidate, which is the conservative reading and matches
 * how this package already treats the unresolved fee direction.
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
  const carryBps = Math.max(...friction.byInterval.map((row) => row.costBps))
  return { carryBps, allInBps: roundTripFrictionBps + carryBps, carryBasis: 'worst-candidate' }
}
