/**
 * How big, given what the trade costs and where it gets liquidated.
 *
 * Cost gating answers whether a trade is worth making. It does not answer the
 * question a trader asks immediately afterwards, and sizing is where most of
 * the damage actually happens: a correct signal at the wrong size is a loss,
 * and the venue's own margin ladder decides what the wrong size is.
 *
 * This is a calculator over constraints the caller supplies, not a
 * recommendation. It reports the largest size that satisfies all of them and
 * names the one that binds, so the caller can see what is actually limiting it.
 */

import { PublicMcpError } from './errors.js'
import { bracketFor, decodeBrackets, maintenanceMarginUsd, type DecodedBracket } from './margin.js'
import type { SymbolRisk } from './schemas.js'

export type BindingConstraint =
  | 'edge-does-not-clear-friction'
  | 'risk-budget'
  | 'venue-bracket-ceiling'
  | 'survivability'

export interface SizingInput {
  risk: SymbolRisk
  /** The move being waited for, in bps. */
  claimedEdgeBps: number
  /** Live round-trip friction, in bps. */
  frictionBps: number
  accountEquityUsd: number
  /** Share of equity the caller will commit as margin. Default 1%. */
  riskBudgetPct?: number
  /**
   * How many times the claimed edge the position must be able to absorb against
   * it before liquidation. Default 2: a move rarely arrives without first going
   * the other way.
   */
  safetyMultiple?: number
}

export interface SizingCandidate {
  leverage: number
  notionalUsd: number
  initialMarginUsd: number
  liquidationDistanceBps: number
  survivableAdverseMoveBps: number
}

export interface SizingResult {
  viable: boolean
  claimedEdgeBps: number
  frictionBps: number
  requiredBufferBps: number
  accountEquityUsd: number
  riskBudgetPct: number
  riskBudgetUsd: number
  safetyMultiple: number
  best: SizingCandidate | null
  bindingConstraint: BindingConstraint
  maxNotionalFromRiskBudget: number
  venueMaxNotionalUsd: number
  narration: string
  warnings: string[]
}

function liquidationDistanceBps(bracket: DecodedBracket, notionalUsd: number, leverage: number): number {
  const initialMargin = notionalUsd / leverage
  const maintenance = maintenanceMarginUsd(bracket, notionalUsd)
  return ((initialMargin - maintenance) / notionalUsd) * 10_000
}

/**
 * Search integer leverages for the largest notional that survives. Leverage is
 * bounded by the venue at 200 or below, so this is a small deterministic sweep
 * rather than an optimisation: the same inputs always give the same answer.
 */
export function sizePosition(input: SizingInput): SizingResult {
  const { risk, claimedEdgeBps, frictionBps, accountEquityUsd } = input
  if (!(accountEquityUsd > 0)) {
    throw new PublicMcpError('invalid_request', 'Account equity must be greater than zero.')
  }

  const riskBudgetPct = input.riskBudgetPct ?? 1
  const safetyMultiple = input.safetyMultiple ?? 2
  const riskBudgetUsd = (accountEquityUsd * riskBudgetPct) / 100
  const requiredBufferBps = frictionBps + safetyMultiple * Math.abs(claimedEdgeBps)

  const brackets = decodeBrackets(risk.mmBrackets)
  const venueMaxNotionalUsd = brackets[brackets.length - 1]?.maxNotionalUsd ?? 0
  const warnings: string[] = []

  // Nothing downstream matters if the edge cannot pay for the round trip.
  if (Math.abs(claimedEdgeBps) <= frictionBps) {
    return {
      viable: false,
      claimedEdgeBps,
      frictionBps,
      requiredBufferBps,
      accountEquityUsd,
      riskBudgetPct,
      riskBudgetUsd,
      safetyMultiple,
      best: null,
      bindingConstraint: 'edge-does-not-clear-friction',
      maxNotionalFromRiskBudget: 0,
      venueMaxNotionalUsd,
      narration: `The claimed edge of ${claimedEdgeBps} bps does not exceed the ${frictionBps} bps it costs to capture it. No size is correct, because the trade loses money at every size even if the signal is exactly right.`,
      warnings: ['Size was not computed. The trade fails the cost gate before sizing is a question.'],
    }
  }

  const ceiling = Math.min(200, Math.floor(risk.maxLeverage))
  let best: SizingCandidate | null = null
  let bindingConstraint: BindingConstraint = 'survivability'
  let maxNotionalFromRiskBudget = 0

  for (let leverage = 1; leverage <= ceiling; leverage += 1) {
    // Margin committed is capped by the risk budget, which fixes notional.
    const budgetNotional = riskBudgetUsd * leverage
    maxNotionalFromRiskBudget = Math.max(maxNotionalFromRiskBudget, budgetNotional)

    const notionalUsd = Math.min(budgetNotional, venueMaxNotionalUsd)
    if (!(notionalUsd > 0)) continue

    const bracket = bracketFor(brackets, notionalUsd)
    if (leverage > Math.min(bracket.maxLeverage, risk.maxLeverage)) continue

    const distance = liquidationDistanceBps(bracket, notionalUsd, leverage)
    const survivable = distance - frictionBps
    if (distance < requiredBufferBps) continue

    if (!best || notionalUsd > best.notionalUsd) {
      best = {
        leverage,
        notionalUsd,
        initialMarginUsd: notionalUsd / leverage,
        liquidationDistanceBps: distance,
        survivableAdverseMoveBps: survivable,
      }
      bindingConstraint =
        notionalUsd >= venueMaxNotionalUsd
          ? 'venue-bracket-ceiling'
          : leverage >= ceiling
            ? 'risk-budget'
            : 'survivability'
    }
  }

  if (!best) {
    return {
      viable: false,
      claimedEdgeBps,
      frictionBps,
      requiredBufferBps,
      accountEquityUsd,
      riskBudgetPct,
      riskBudgetUsd,
      safetyMultiple,
      best: null,
      bindingConstraint: 'survivability',
      maxNotionalFromRiskBudget,
      venueMaxNotionalUsd,
      narration: `No leverage on this market leaves a liquidation buffer of ${requiredBufferBps.toFixed(1)} bps, which is what a ${Math.abs(claimedEdgeBps)} bps edge needs at a ${safetyMultiple}x safety multiple over ${frictionBps} bps of friction. Either the edge is too small to be worth the margin it consumes, or the safety multiple is too demanding for this venue.`,
      warnings: [
        'Every leverage was rejected on survivability. Lowering the safety multiple relaxes this, but it relaxes the thing protecting the position.',
      ],
    }
  }

  if (best.leverage === 1) {
    warnings.push(
      'Only unleveraged size survives the required buffer. Any leverage here liquidates before the move being waited for arrives.',
    )
  }
  if (bindingConstraint === 'venue-bracket-ceiling') {
    warnings.push(
      `Size is capped by the venue rather than by the account: the published brackets stop at ${venueMaxNotionalUsd} USD notional.`,
    )
  }
  warnings.push(
    'This is arithmetic over the constraints supplied, not a recommendation, and it assumes one isolated position with no other exposure.',
  )
  warnings.push('It sizes a claim. It does not check whether the claim is true.')

  return {
    viable: true,
    claimedEdgeBps,
    frictionBps,
    requiredBufferBps,
    accountEquityUsd,
    riskBudgetPct,
    riskBudgetUsd,
    safetyMultiple,
    best,
    bindingConstraint,
    maxNotionalFromRiskBudget,
    venueMaxNotionalUsd,
    narration: `Largest size satisfying every constraint: ${best.notionalUsd.toFixed(0)} USD notional at ${best.leverage}x, committing ${best.initialMarginUsd.toFixed(0)} USD of margin. It absorbs ${best.survivableAdverseMoveBps.toFixed(1)} bps against it after friction, against the ${Math.abs(claimedEdgeBps)} bps move being waited for. The binding constraint is ${bindingConstraint}.`,
    warnings,
  }
}
