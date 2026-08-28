/**
 * Live friction measurement. Fees are data, never constants.
 *
 * Two honesty constraints are structural here and must survive refactoring:
 *
 * 1. The engine's `totalFeeRateBps` does not state whether it is per side or a
 *    round trip. This module assumes PER SIDE, the conservative reading, and
 *    carries the assumption in `basisNote` so a caller cannot inherit it
 *    silently. Because that assumption is worth a factor of two on the headline
 *    number, every sample also reports BOTH readings as an interval, so a
 *    caller sees the uncertainty as a range rather than a footnote it can drop.
 * 2. Spread is not yet measured on v2. Every sample therefore reports
 *    `isLowerBound: true`: true friction is greater than or equal to this
 *    number, never less. A lower bound is still a valid floor input.
 */

import type { EngineReadClient } from './client.js'
import { SPREAD_SURFACE_PROBE } from './constants.js'
import { PublicMcpError } from './errors.js'

export type ComponentBasis = 'engine-reported' | 'operator-supplied' | 'unmeasured'

export type FeeDirection = 'per-side' | 'round-trip'

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

/**
 * Both readings of the engine fee rate, carried side by side. The headline
 * number uses `assumed`; the other bound is stated so a caller can see what the
 * unresolved question is worth. Both figures include any measured spread, so
 * either can be compared directly against `quote.roundTripBps`.
 */
export interface FeeDirectionInterval {
  assumed: FeeDirection
  /** True only when an operator has explicitly declared the direction. */
  resolved: boolean
  engineReportedBps: number
  roundTripBpsIfPerSide: number
  roundTripBpsIfRoundTrip: number
  note: string
}

export interface SpreadSurface {
  status: 'absent' | 'operator-supplied'
  probedAtIso: string
  note: string
}

export interface FrictionSample {
  quote: FrictionQuote
  feeBasis: ComponentBasis
  spreadBasis: ComponentBasis
  /** True when the round trip omits an unmeasured component. Floor is >= this. */
  isLowerBound: boolean
  tierLevel: number
  feeDirection: FeeDirectionInterval
  spreadSurface: SpreadSurface
  basisNote: string
  limitations: string[]
}

export interface FrictionOptions {
  /** Fee tier to price against. Tier 0 is the most expensive and the safe default. */
  tierLevel?: number
  /**
   * Direction of the engine fee rate, once an operator has confirmed it. Left
   * undefined, the module assumes per side and says so. Setting it either way
   * marks the question resolved, so `false` means confirmed per side rather
   * than merely assumed.
   */
  feeIsRoundTrip?: boolean | undefined
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

    const resolved = this.options.feeIsRoundTrip !== undefined
    const treatAsRoundTrip = this.options.feeIsRoundTrip === true
    const perSideFeeBps = treatAsRoundTrip ? tier.totalFeeRateBps / 2 : tier.totalFeeRateBps
    const roundTripFeeBps = perSideFeeBps * 2

    const spreadPerSide = this.options.spreadBpsPerSide
    const spreadMeasured = typeof spreadPerSide === 'number' && Number.isFinite(spreadPerSide)
    const openSpreadBps = spreadMeasured ? spreadPerSide : 0
    const closeSpreadBps = spreadMeasured ? spreadPerSide : 0
    const spreadTotalBps = openSpreadBps + closeSpreadBps

    const feeDirection: FeeDirectionInterval = {
      assumed: treatAsRoundTrip ? 'round-trip' : 'per-side',
      resolved,
      engineReportedBps: tier.totalFeeRateBps,
      roundTripBpsIfPerSide: tier.totalFeeRateBps * 2 + spreadTotalBps,
      roundTripBpsIfRoundTrip: tier.totalFeeRateBps + spreadTotalBps,
      note: resolved
        ? `Fee direction was declared by operator configuration as ${treatAsRoundTrip ? 'ROUND TRIP' : 'PER SIDE'}. The other reading is shown for comparison only.`
        : 'Fee direction is UNRESOLVED. The engine does not state whether totalFeeRateBps covers one side or a round trip, and the answer is worth a factor of two on this number. The headline figure takes the conservative per-side reading. Treat the pair as an interval until the protocol team confirms it.',
    }

    const spreadSurface: SpreadSurface = spreadMeasured
      ? {
          status: 'operator-supplied',
          probedAtIso: SPREAD_SURFACE_PROBE.probedAtIso,
          note: `Spread of ${spreadPerSide} bps per side was supplied by operator configuration, not measured by this server.`,
        }
      : {
          status: 'absent',
          probedAtIso: SPREAD_SURFACE_PROBE.probedAtIso,
          note: SPREAD_SURFACE_PROBE.note,
        }

    const limitations = ['Fee values are reported exactly as supplied by the live v2 engine.']
    if (!resolved) {
      limitations.push(
        `The engine does not state fee direction. This sample assumes the reported rate is PER SIDE and doubles it, which is the conservative reading. The round trip is ${feeDirection.roundTripBpsIfPerSide} bps under that reading and ${feeDirection.roundTripBpsIfRoundTrip} bps under the other. Do not treat the headline number as settled while both are shown.`,
      )
    }
    if (!spreadMeasured) {
      limitations.push(
        'Spread is not measured on v2 and is excluded. This value is a measured fee floor, not all-in friction. True friction is higher.',
      )
      limitations.push(SPREAD_SURFACE_PROBE.note)
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
      feeDirection,
      spreadSurface,
      basisNote:
        `Live engine fee ladder, tier ${tier.tierLevel} = ${tier.totalFeeRateBps} bps, ` +
        `interpreted as ${treatAsRoundTrip ? 'ROUND TRIP' : 'PER SIDE'}${resolved ? ' (operator-declared)' : ' (unverified)'}, ` +
        `giving ${roundTripFeeBps} bps of round-trip fees` +
        (resolved ? '. ' : `; the other reading gives ${tier.totalFeeRateBps} bps. `) +
        (spreadMeasured
          ? `Operator-supplied spread of ${spreadPerSide} bps per side included.`
          : 'Spread unmeasured and excluded.'),
      limitations,
    }
  }
}
