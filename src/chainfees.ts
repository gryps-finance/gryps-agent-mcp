/**
 * Fees measured from settled fills on chain, rather than read from the venue's
 * own fee schedule.
 *
 * Everything else in this package asks the engine what it charges. This asks
 * the chain what was actually paid: it reads the settlement contract's event
 * log from a public explorer, decodes the fee and notional out of each
 * fee-bearing event, and reports the median. No key, no account, no permission.
 *
 * Two reasons that matters. A schedule is a claim and a fill is a fact, so this
 * is the one number here that nobody has to take on trust. And because the
 * measurement is one-way by construction, comparing it against the advertised
 * rate is direct evidence on whether that rate covers one side or a round trip,
 * which is the largest open question in this package.
 *
 * It is still a sample. Different accounts sit in different fee tiers, so a
 * median across recent venue activity is not the rate any particular account
 * pays. Sample size and spread ship with every result for that reason.
 */

import { z } from 'zod'
import { CANONICAL_SETTLEMENT } from './constants.js'
import { PublicMcpError } from './errors.js'

/**
 * Event signatures that carry fee economics. Verified against live Polygon logs
 * for the canonical settlement contract on 2026-08-29.
 */
export const FEE_TOPICS = {
  OrderPlaced: '0x208c7ce55ae371af21b7eac28b68ac1b26823fac2d2af3e47a24b79c4778711a',
  TradeFilled: '0x80054c3646828ebb21db270b77e093f9b2744b911fa546529dcbc956fd98c6e5',
} as const

const logItemSchema = z.object({
  topics: z.array(z.string().nullable()),
  data: z.string(),
})

const logsPageSchema = z.object({
  items: z.array(logItemSchema),
  next_page_params: z.record(z.string(), z.unknown()).nullable().optional(),
})

/** One 32-byte word of ABI-encoded data, by index. */
function word(data: string, index: number): string {
  return data.slice(2 + index * 64, 2 + (index + 1) * 64)
}

function toBigInt(hex: string): bigint {
  return BigInt(`0x${hex || '0'}`)
}

/** A bytes32-embedded ASCII symbol, with trailing padding stripped. */
export function symbolFromBytes32(hex: string): string {
  const trimmed = hex.replace(/(00)+$/, '')
  let out = ''
  for (let i = 0; i < trimmed.length; i += 2) {
    const code = Number.parseInt(trimmed.slice(i, i + 2), 16)
    out += code >= 32 && code < 127 ? String.fromCharCode(code) : '?'
  }
  return out
}

export interface FeeObservation {
  orderId: string
  symbol: string
  /** Fee paid on one side, as a fraction of notional, in basis points. */
  feeBpsOneWay: number
  notionalUsdc: number
  /** True when taken from a fill rather than an order placement. */
  fromFill: boolean
}

/** Decode one log into a fee observation, or null if it carries no fee economics. */
export function decodeFeeObservation(log: { topics: (string | null)[]; data: string }): FeeObservation | null {
  const topic = log.topics[0] ?? ''
  let orderIdWord: number
  let symbolWord: number
  let economicsBase: number
  let fromFill: boolean

  if (topic === FEE_TOPICS.TradeFilled) {
    orderIdWord = 1
    symbolWord = 3
    economicsBase = 6
    fromFill = true
  } else if (topic === FEE_TOPICS.OrderPlaced) {
    orderIdWord = 1
    symbolWord = 2
    economicsBase = 5
    fromFill = false
  } else {
    return null
  }

  const data = log.data
  const affiliate = toBigInt(word(data, economicsBase))
  const platform = toBigInt(word(data, economicsBase + 1))
  const hedger = toBigInt(word(data, economicsBase + 2))
  const notional = toBigInt(word(data, economicsBase + 4))
  if (notional === 0n) return null

  return {
    orderId: `0x${word(data, orderIdWord)}`,
    symbol: symbolFromBytes32(word(data, symbolWord)),
    feeBpsOneWay: (Number(affiliate + platform + hedger) / Number(notional)) * 10_000,
    notionalUsdc: Number(notional) / 1e6,
    fromFill,
  }
}

export interface ChainFeeOptions {
  explorerUrl: string
  contract?: string
  maxPages?: number
  timeoutMs: number
  fetcher?: typeof fetch
}

export interface MeasuredFeeResult {
  symbol: string | null
  scope: 'symbol-specific' | 'venue-wide'
  sampleSize: number
  medianOneWayBps: number
  roundTripBps: number
  minOneWayBps: number
  maxOneWayBps: number
  distinctSymbols: number
  pagesScanned: number
  contract: string
  measuredAtIso: string
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/** Below this, a symbol-specific median is noise, so the venue-wide one is used. */
const MIN_SYMBOL_OBSERVATIONS = 5

export class ChainFeeSource {
  private readonly fetcher: typeof fetch
  private readonly contract: string
  private readonly maxPages: number

  constructor(private readonly options: ChainFeeOptions) {
    this.fetcher = options.fetcher ?? fetch
    this.contract = options.contract ?? CANONICAL_SETTLEMENT.contract
    this.maxPages = Math.min(Math.max(options.maxPages ?? 4, 1), 10)
  }

  private async page(params: Record<string, unknown> | null): Promise<z.infer<typeof logsPageSchema>> {
    const url = new URL(`${this.options.explorerUrl}/addresses/${this.contract}/logs`)
    if (params) {
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    }
    let response: Response
    try {
      response = await this.fetcher(url.toString(), {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      })
    } catch {
      throw new PublicMcpError('upstream_unavailable', 'The chain explorer is unreachable.', {
        retryable: true,
      })
    }
    if (!response.ok) {
      throw new PublicMcpError(
        'upstream_unavailable',
        `The chain explorer returned HTTP ${response.status}.`,
        { retryable: response.status === 429 || response.status >= 500 },
      )
    }
    const parsed = logsPageSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new PublicMcpError('upstream_schema_mismatch', 'The chain explorer returned an unexpected log shape.')
    }
    return parsed.data
  }

  /**
   * Walk recent settlement events and report the median fee actually paid.
   * Observations are deduped by order id, with a fill preferred over the
   * placement it settles, so one trade counts once.
   */
  async measure(symbol?: string | undefined): Promise<MeasuredFeeResult> {
    const byOrder = new Map<string, FeeObservation>()
    let params: Record<string, unknown> | null = null
    let pages = 0

    for (let index = 0; index < this.maxPages; index += 1) {
      const page = await this.page(params)
      pages += 1
      for (const item of page.items) {
        const observation = decodeFeeObservation(item)
        if (!observation) continue
        const existing = byOrder.get(observation.orderId)
        if (!existing || (observation.fromFill && !existing.fromFill)) {
          byOrder.set(observation.orderId, observation)
        }
      }
      const next = page.next_page_params
      if (!next) break
      params = next
    }

    const all = [...byOrder.values()]
    if (all.length === 0) {
      throw new PublicMcpError(
        'not_found',
        'No fee-bearing settlement events were found in the scanned window. The venue may simply have been quiet.',
      )
    }

    const forSymbol = symbol ? all.filter((observation) => observation.symbol === symbol) : []
    const useSymbol = forSymbol.length >= MIN_SYMBOL_OBSERVATIONS
    const used = useSymbol ? forSymbol : all
    const bps = used.map((observation) => observation.feeBpsOneWay)
    const medianOneWay = median(bps)

    return {
      symbol: symbol ?? null,
      scope: useSymbol ? 'symbol-specific' : 'venue-wide',
      sampleSize: used.length,
      medianOneWayBps: medianOneWay,
      roundTripBps: medianOneWay * 2,
      minOneWayBps: Math.min(...bps),
      maxOneWayBps: Math.max(...bps),
      distinctSymbols: new Set(used.map((observation) => observation.symbol)).size,
      pagesScanned: pages,
      contract: this.contract,
      measuredAtIso: new Date().toISOString(),
    }
  }
}

export type FeeDirectionEvidence = 'supports-per-side' | 'supports-round-trip' | 'inconclusive'

export interface FeeDirectionFinding {
  advertisedBps: number
  measuredOneWayBps: number
  /** What one side would cost if the advertised rate covered a full round trip. */
  impliedOneWayIfRoundTrip: number
  evidence: FeeDirectionEvidence
  reasoning: string
  caution: string
}

/**
 * Compare a measured one-way fee against the advertised rate. Because the
 * measurement is one-way by construction, it discriminates directly between the
 * two readings of the schedule.
 */
export function assessFeeDirection(advertisedBps: number, measuredOneWayBps: number, sampleSize: number): FeeDirectionFinding {
  const impliedOneWayIfRoundTrip = advertisedBps / 2
  const distanceToPerSide = Math.abs(measuredOneWayBps - advertisedBps)
  const distanceToRoundTrip = Math.abs(measuredOneWayBps - impliedOneWayIfRoundTrip)

  let evidence: FeeDirectionEvidence = 'inconclusive'
  // Require a clear separation; near-equal distances tell us nothing.
  if (distanceToPerSide * 1.5 < distanceToRoundTrip) evidence = 'supports-per-side'
  else if (distanceToRoundTrip * 1.5 < distanceToPerSide) evidence = 'supports-round-trip'

  const reasoning =
    `Fills paid a median of ${measuredOneWayBps.toFixed(2)} bps on one side. If the advertised ` +
    `${advertisedBps} bps covered one side, that is what a fill should cost; if it covered a round trip, ` +
    `one side should cost about ${impliedOneWayIfRoundTrip.toFixed(2)} bps. ` +
    (evidence === 'supports-per-side'
      ? 'The measurement sits closer to the per-side reading.'
      : evidence === 'supports-round-trip'
        ? 'The measurement sits closer to the round-trip reading.'
        : 'The measurement does not clearly favour either reading.')

  return {
    advertisedBps,
    measuredOneWayBps,
    impliedOneWayIfRoundTrip,
    evidence,
    reasoning,
    caution:
      `This is evidence from ${sampleSize} recent fills, not a confirmation from the protocol team. ` +
      'Different accounts sit in different fee tiers, so a venue-wide median is not the rate any one account pays. ' +
      'It should inform the question, not close it.',
  }
}
