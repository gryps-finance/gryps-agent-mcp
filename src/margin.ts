/**
 * Margin and liquidation arithmetic from the venue's own published brackets.
 *
 * The engine already returns a full maintenance-margin ladder per symbol on
 * every `risk-config` read. Until now this package validated that ladder and
 * threw it away, which meant an agent could learn what a trade costs but not
 * how far the price has to move before the position stops existing. Those are
 * the two halves of the same question.
 *
 * Everything here is derived from published brackets, not from the engine's
 * liquidation engine. It is arithmetic on public parameters, and it is labelled
 * that way wherever it surfaces: the venue liquidates, this package only
 * calculates.
 */

import { PRICE_SCALE } from './constants.js'
import { PublicMcpError } from './errors.js'
import type { MaintenanceBracket, SymbolRisk } from './schemas.js'

/** Bracket notionals and cumulative offsets share the engine 1e6 fixed point. */
function decode(raw: string): number {
  return Number(raw) / PRICE_SCALE
}

export interface DecodedBracket {
  index: number
  maxNotionalUsd: number
  maintenanceMarginRateBps: number
  cumulativeOffsetUsd: number
  maxLeverage: number
}

export function decodeBrackets(brackets: MaintenanceBracket[]): DecodedBracket[] {
  return brackets
    .map((bracket, index) => ({
      index,
      maxNotionalUsd: decode(bracket.maxNotional),
      maintenanceMarginRateBps: bracket.mmrBps,
      cumulativeOffsetUsd: decode(bracket.cum),
      maxLeverage: bracket.maxLeverage,
    }))
    .sort((a, b) => a.maxNotionalUsd - b.maxNotionalUsd)
}

/**
 * The bracket a position of this size falls into. Brackets are tiers, not
 * choices: size decides which one applies, and a larger position is charged a
 * higher maintenance rate whether or not the trader wanted the leverage.
 */
export function bracketFor(brackets: DecodedBracket[], notionalUsd: number): DecodedBracket {
  const found = brackets.find((bracket) => notionalUsd <= bracket.maxNotionalUsd)
  if (found) return found
  const largest = brackets[brackets.length - 1]
  if (!largest) {
    throw new PublicMcpError(
      'upstream_schema_mismatch',
      'The engine returned no maintenance-margin brackets for this market.',
    )
  }
  throw new PublicMcpError(
    'invalid_request',
    `A notional of ${notionalUsd} exceeds the largest published bracket for this market (${largest.maxNotionalUsd}). The venue publishes no margin terms above that size.`,
  )
}

export interface MarginProfile {
  notionalUsd: number
  side: 'long' | 'short'
  requestedLeverage: number
  /** Leverage actually priced, after the bracket ceiling is applied. */
  effectiveLeverage: number
  leverageWasClamped: boolean
  maxLeverageAtThisSize: number
  maxLeverageForSymbol: number
  bracket: DecodedBracket
  initialMarginUsd: number
  maintenanceMarginUsd: number
  /** Loss the position can absorb before maintenance margin is breached. */
  bufferUsd: number
  /** That buffer expressed as an adverse move, in basis points. */
  liquidationDistanceBps: number
  liquidationPriceUsd: number | null
  entryPriceUsd: number | null
  notes: string[]
}

export interface MarginInput {
  risk: SymbolRisk
  notionalUsd: number
  side: 'long' | 'short'
  leverage?: number | undefined
  entryPriceUsd?: number | undefined
}

/**
 * Maintenance margin follows the standard bracket form: the position is charged
 * the bracket's rate on its whole notional, less the cumulative offset that
 * keeps the ladder continuous at each boundary.
 */
export function maintenanceMarginUsd(bracket: DecodedBracket, notionalUsd: number): number {
  return (notionalUsd * bracket.maintenanceMarginRateBps) / 10_000 - bracket.cumulativeOffsetUsd
}

export function marginProfile(input: MarginInput): MarginProfile {
  const { risk, notionalUsd, side } = input
  if (!(notionalUsd > 0)) {
    throw new PublicMcpError('invalid_request', 'Notional must be greater than zero.')
  }

  const brackets = decodeBrackets(risk.mmBrackets)
  const bracket = bracketFor(brackets, notionalUsd)
  const requestedLeverage = input.leverage ?? risk.defaultLeverage
  if (!(requestedLeverage > 0)) {
    throw new PublicMcpError('invalid_request', 'Leverage must be greater than zero.')
  }

  // Two ceilings apply: the symbol's own maximum and the bracket's, and the
  // bracket's is the one that bites as size grows.
  const ceiling = Math.min(bracket.maxLeverage, risk.maxLeverage)
  const effectiveLeverage = Math.min(requestedLeverage, ceiling)
  const leverageWasClamped = effectiveLeverage < requestedLeverage

  const initialMarginUsd = notionalUsd / effectiveLeverage
  const maintenance = maintenanceMarginUsd(bracket, notionalUsd)
  const bufferUsd = initialMarginUsd - maintenance
  const liquidationDistanceBps = (bufferUsd / notionalUsd) * 10_000

  const entryPriceUsd = input.entryPriceUsd ?? null
  const direction = side === 'long' ? -1 : 1
  const liquidationPriceUsd =
    entryPriceUsd === null ? null : entryPriceUsd * (1 + (direction * liquidationDistanceBps) / 10_000)

  const notes: string[] = [
    'Derived from the published maintenance-margin brackets, not from the engine liquidation engine. The venue liquidates; this is arithmetic on its public parameters.',
    'Assumes one isolated position and no other exposure. Cross margin, a second position, or existing unrealised loss all move liquidation closer.',
    'Fees and funding already paid are not deducted. Every cost charged against the position shortens this buffer.',
  ]
  if (leverageWasClamped) {
    notes.push(
      `Requested leverage ${requestedLeverage} is not available at this size. The bracket covering ${notionalUsd} USD caps leverage at ${bracket.maxLeverage}, and the symbol caps it at ${risk.maxLeverage}; ${effectiveLeverage} was used.`,
    )
  }
  if (bufferUsd <= 0) {
    notes.push(
      'Initial margin does not exceed maintenance margin at this size and leverage. A position opened here would be liquidatable immediately.',
    )
  }

  return {
    notionalUsd,
    side,
    requestedLeverage,
    effectiveLeverage,
    leverageWasClamped,
    maxLeverageAtThisSize: ceiling,
    maxLeverageForSymbol: risk.maxLeverage,
    bracket,
    initialMarginUsd,
    maintenanceMarginUsd: maintenance,
    bufferUsd,
    liquidationDistanceBps,
    liquidationPriceUsd,
    entryPriceUsd,
    notes,
  }
}

/**
 * The comparison that makes this worth computing: an edge is unreachable if the
 * position is liquidated before the move it is waiting for arrives. Friction is
 * charged against the same buffer, so it is counted here too.
 */
export interface SurvivalCheck {
  claimedEdgeBps: number
  liquidationDistanceBps: number
  frictionBps: number
  /** Adverse room left once friction is charged against the buffer. */
  survivableAdverseMoveBps: number
  edgeReachable: boolean
  verdict: string
}

export function checkSurvival(
  profile: MarginProfile,
  claimedEdgeBps: number,
  frictionBps: number,
): SurvivalCheck {
  const survivableAdverseMoveBps = profile.liquidationDistanceBps - frictionBps
  // A move rarely arrives without going against you first. If the position
  // cannot absorb a move the size of the edge it is waiting for, the thesis
  // needs the price to be right immediately, which is a different bet.
  const edgeReachable = survivableAdverseMoveBps > Math.abs(claimedEdgeBps)

  return {
    claimedEdgeBps,
    liquidationDistanceBps: profile.liquidationDistanceBps,
    frictionBps,
    survivableAdverseMoveBps,
    edgeReachable,
    verdict: edgeReachable
      ? `Survivable: the position absorbs ${survivableAdverseMoveBps.toFixed(1)} bps against it after friction, more than the ${Math.abs(claimedEdgeBps).toFixed(1)} bps move being waited for.`
      : `Fragile: the position absorbs only ${survivableAdverseMoveBps.toFixed(1)} bps against it after friction, less than the ${Math.abs(claimedEdgeBps).toFixed(1)} bps move being waited for. A normal retrace liquidates this before the thesis resolves. Size down or use less leverage.`,
  }
}
