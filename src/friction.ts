/**
 * Live friction measurement. Fees are data, never constants.
 *
 * Two honesty constraints are structural here and must survive refactoring:
 *
 * 1. The engine's `totalFeeRateBps` does not state whether it is per side or a
 *    round trip. This module assumes PER SIDE, the conservative reading, and
 *    carries the assumption in `basisNote` so a caller cannot inherit it
 *    silently. One flag flips it once the protocol team confirms.
 * 2. Spread is not yet measured on v2. Every sample therefore reports
 *    `isLowerBound: true`: true friction is greater than or equal to this
 *    number, never less. A lower bound is still a valid floor input.
 */

import type { EngineReadClient } from './client.js'
import { PublicMcpError } from './errors.js'

export type ComponentBasis = 'engine-reported' | 'operator-supplied' | 'unmeasured'

export interface FrictionQuote {
  venueId: string
  symbol: string
  openSpreadBps: number
  closeSpreadBps: number
  protocolFeeBps: number
  /** The number a claimed edge must beat to be worth acting on. */
  roundTripBps: number
  measuredAtIso: string
}

export interface FrictionSample {
  quote: FrictionQuote
  feeBasis: ComponentBasis
  spreadBasis: ComponentBasis
  /** True when the round trip omits an unmeasured component. Floor is >= this. */
  isLowerBound: boolean
  tierLevel: number
  basisNote: string
  limitations: string[]
}

export interface FrictionOptions {
  /** Fee tier to price against. Tier 0 is the most expensive and the safe default. */
  tierLevel?: number
  /** Set once the protocol team confirms the engine reports a full round trip. */
  feeIsRoundTrip?: boolean
  /** Operator-measured spread in bps per side. Explicitly supplied, never inferred. */
  spreadBpsPerSide?: number
  nowIso?: () => string
}

function completeQuote(parts: Omit<FrictionQuote, 'roundTripBps'>): FrictionQuote {
  return {
    ...parts,
    roundTripBps: parts.openSpreadBps + parts.closeSpreadBps + parts.protocolFeeBps,
  }
}

export class FrictionService {
  constructor(
    private readonly client: EngineReadClient,
    private readonly options: FrictionOptions = {},
  ) {}

  private nowIso(): string {
    return (this.options.nowIso ?? (() => new Date().toISOString()))()
  }

  async sample(symbol: string): Promise<FrictionSample> {
    const risk = await this.client.riskConfig()
    const wanted = this.options.tierLevel ?? 0
    const tier = risk.feeTiers.find((candidate) => candidate.tierLevel === wanted)
    if (!tier) {
      throw new PublicMcpError(
        'not_found',
        `Fee tier ${wanted} is not present in the live engine ladder. Available levels: ${risk.feeTiers
          .map((candidate) => candidate.tierLevel)
          .join(', ')}.`,
      )
    }

    const perSideFeeBps = this.options.feeIsRoundTrip ? tier.totalFeeRateBps / 2 : tier.totalFeeRateBps
    const roundTripFeeBps = perSideFeeBps * 2

    const spreadPerSide = this.options.spreadBpsPerSide
    const spreadMeasured = typeof spreadPerSide === 'number' && Number.isFinite(spreadPerSide)
    const openSpreadBps = spreadMeasured ? spreadPerSide : 0
    const closeSpreadBps = spreadMeasured ? spreadPerSide : 0

    const limitations = [
      'Fee values are reported exactly as supplied by the live v2 engine.',
    ]
    if (!this.options.feeIsRoundTrip) {
      limitations.push(
        'The engine does not state fee direction. This sample assumes the reported rate is PER SIDE and doubles it, which is the conservative reading.',
      )
    }
    if (!spreadMeasured) {
      limitations.push(
        'Spread is not measured on v2 and is excluded. This value is a measured fee floor, not all-in friction. True friction is higher.',
      )
    }

    return {
      quote: completeQuote({
        venueId: 'gryps-v2',
        symbol,
        openSpreadBps,
        closeSpreadBps,
        protocolFeeBps: roundTripFeeBps,
        measuredAtIso: this.nowIso(),
      }),
      feeBasis: 'engine-reported',
      spreadBasis: spreadMeasured ? 'operator-supplied' : 'unmeasured',
      isLowerBound: !spreadMeasured,
      tierLevel: tier.tierLevel,
      basisNote:
        `Live engine fee ladder, tier ${tier.tierLevel} = ${tier.totalFeeRateBps} bps, ` +
        `interpreted as ${this.options.feeIsRoundTrip ? 'ROUND TRIP' : 'PER SIDE (unverified)'}, ` +
        `giving ${roundTripFeeBps} bps of round-trip fees. ` +
        (spreadMeasured
          ? `Operator-supplied spread of ${spreadPerSide} bps per side included.`
          : 'Spread unmeasured and excluded.'),
      limitations,
    }
  }
}
