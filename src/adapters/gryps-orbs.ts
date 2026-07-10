/**
 * Gryps v1 (Orbs solver) adapter — READ-ONLY.
 * The only file in this package allowed to know the upstream API's shape.
 * When the drift sentinel reports schema change, this file absorbs it.
 *
 * No env-var reads (ADR-009): configuration is passed explicitly.
 */

import type {
  FundingSnapshot,
  MarketSummary,
  OpenInterestSnapshot,
  VenueAdapter,
} from './types.js'

export interface GrypsOrbsConfig {
  /** Solver registry base, e.g. the perps-streaming v1 root incl. chain + solver address. */
  solverBaseUrl: string
  /** App-level solver API base (aggregated OI / funding endpoints). */
  appApiBaseUrl: string
  timeoutMs?: number
}

interface RawSymbol {
  symbol: string
  name: string
  is_valid: boolean
  rfq_allowed: boolean
  max_leverage: number
  min_notional_value: number
  max_notional_value: number
  trading_fee: number
  hedger_fee_open: string | number
  hedger_fee_close: string | number
  funding_rate_epoch_duration_ms: number
  max_funding_rate: number
  cats_binance?: string[]
}

async function getJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`)
  }
  return res.json()
}

export class GrypsOrbsAdapter implements VenueAdapter {
  readonly venueId = 'gryps-orbs-v1'
  readonly apiVersionPin = '2026-07-10' // last sentinel-verified snapshot

  constructor(private readonly config: GrypsOrbsConfig) {}

  private get timeout(): number {
    return this.config.timeoutMs ?? 15_000
  }

  private mapSymbol(raw: RawSymbol): MarketSummary {
    return {
      symbol: raw.symbol,
      name: raw.name,
      isValid: raw.is_valid,
      rfqAllowed: raw.rfq_allowed,
      maxLeverage: raw.max_leverage,
      minNotionalUsd: raw.min_notional_value,
      maxNotionalUsd: raw.max_notional_value,
      tradingFee: Number(raw.trading_fee),
      hedgerFeeOpen: Number(raw.hedger_fee_open),
      hedgerFeeClose: Number(raw.hedger_fee_close),
      fundingEpochMs: raw.funding_rate_epoch_duration_ms,
      categories: raw.cats_binance ?? [],
    }
  }

  private async rawSymbols(): Promise<RawSymbol[]> {
    const data = await getJson(
      `${this.config.solverBaseUrl}/contract-symbols`,
      this.timeout,
    )
    const arr = Array.isArray(data)
      ? data
      : ((data as { symbols?: unknown[] }).symbols ?? [])
    return arr as RawSymbol[]
  }

  async listMarkets(): Promise<MarketSummary[]> {
    const raw = await this.rawSymbols()
    return raw.map((r) => this.mapSymbol(r))
  }

  async getMarket(symbol: string): Promise<MarketSummary | null> {
    const all = await this.listMarkets()
    const s = symbol.toUpperCase()
    return (
      all.find((m) => m.symbol === s || m.name === s || m.name === `${s}USDT`) ??
      null
    )
  }

  async getFunding(symbol: string): Promise<FundingSnapshot | null> {
    const raw = await this.rawSymbols()
    const s = symbol.toUpperCase()
    const hit = raw.find((r) => r.symbol === s || r.name === `${s}USDT`)
    if (!hit) return null
    return {
      symbol: hit.symbol,
      fundingEpochMs: hit.funding_rate_epoch_duration_ms,
      maxFundingRate: hit.max_funding_rate,
    }
  }

  async getAggregatedOpenInterest(): Promise<OpenInterestSnapshot> {
    const raw = await getJson(
      `${this.config.appApiBaseUrl}/solver/aggregatedOpenInterest?chainId=0`,
      this.timeout,
    )
    return { raw, fetchedAtIso: new Date().toISOString() }
  }
}
