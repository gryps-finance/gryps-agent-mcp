/**
 * Venue adapter contract — the ONE seam (ADR-002).
 * Nothing outside src/adapters/ may know a venue API's shape.
 * Fees, symbols, leverage, funding params are runtime DATA, never constants.
 */

export interface MarketSummary {
  symbol: string
  name: string
  isValid: boolean
  rfqAllowed: boolean
  maxLeverage: number
  minNotionalUsd: number
  maxNotionalUsd: number
  /** Fees as data — read live, never hardcoded. Decimal fractions (0.00005 = 0.5 bps). */
  tradingFee: number
  hedgerFeeOpen: number
  hedgerFeeClose: number
  fundingEpochMs: number
  categories: string[]
}

export interface FundingSnapshot {
  symbol: string
  fundingEpochMs: number
  maxFundingRate: number
}

export interface OpenInterestSnapshot {
  raw: unknown
  fetchedAtIso: string
}

export interface VenueAdapter {
  readonly venueId: string
  /** Pinned upstream API identity; bump when the drift sentinel reports change. */
  readonly apiVersionPin: string
  listMarkets(): Promise<MarketSummary[]>
  getMarket(symbol: string): Promise<MarketSummary | null>
  getFunding(symbol: string): Promise<FundingSnapshot | null>
  getAggregatedOpenInterest(): Promise<OpenInterestSnapshot>
}
