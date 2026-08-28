/**
 * Venue cost comparison.
 *
 * The Gryps side is a fixed quoted cost derived from the live friction floor:
 * an RFQ venue quotes a price, so cost does not grow with clip size the way a
 * lit book does. The comparison venue is priced by walking its displayed order
 * book level by level and measuring volume-weighted fill against mid.
 *
 * Displayed liquidity is not the same as executable liquidity. Hidden and
 * iceberg flow exist, and books refresh. The book side is therefore labelled
 * as a walk of the visible book, which is the honest thing it is.
 *
 * This tool will report that another venue is cheaper when that is what the
 * numbers say. A comparison that can only ever favour its author is worthless.
 */

import { z } from 'zod'
import type { FrictionSample } from './friction.js'
import { PublicMcpError } from './errors.js'

export interface BookLevel {
  price: number
  size: number
}

export interface L2Book {
  symbol: string
  /** Best first, descending price. */
  bids: BookLevel[]
  /** Best first, ascending price. */
  asks: BookLevel[]
}

const hlLevelSchema = z.object({ px: z.string(), sz: z.string() })
const hlBookSchema = z.object({
  levels: z.tuple([z.array(hlLevelSchema), z.array(hlLevelSchema)]),
})

export function bookMid(book: L2Book): number | null {
  const bestBid = book.bids[0]?.price
  const bestAsk = book.asks[0]?.price
  if (bestBid === undefined || bestAsk === undefined) return null
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) return null
  return (bestBid + bestAsk) / 2
}

export interface WalkResult {
  vwap: number
  mid: number
  impactBps: number
  filledNotionalUsd: number
  exhausted: boolean
  levelsConsumed: number
}

export function walkBook(book: L2Book, side: 'buy' | 'sell', notionalUsd: number): WalkResult | null {
  const mid = bookMid(book)
  if (mid === null || notionalUsd <= 0) return null
  const levels = side === 'buy' ? book.asks : book.bids

  let remainingUsd = notionalUsd
  let costUsd = 0
  let quantity = 0
  let levelsConsumed = 0

  for (const level of levels) {
    if (remainingUsd <= 0) break
    if (!Number.isFinite(level.price) || !Number.isFinite(level.size) || level.price <= 0) continue
    const levelNotional = level.price * level.size
    const takeUsd = Math.min(remainingUsd, levelNotional)
    costUsd += takeUsd
    quantity += takeUsd / level.price
    remainingUsd -= takeUsd
    levelsConsumed += 1
  }

  if (quantity === 0) return null
  const vwap = costUsd / quantity
  const direction = side === 'buy' ? 1 : -1
  return {
    vwap,
    mid,
    impactBps: ((direction * (vwap - mid)) / mid) * 10_000,
    filledNotionalUsd: notionalUsd - remainingUsd,
    exhausted: remainingUsd > 0,
    levelsConsumed,
  }
}

export interface BookRoundTrip {
  entryImpactBps: number
  exitImpactBps: number
  takerFeeRoundTripBps: number
  allInBps: number
  exhausted: boolean
  note: string
}

export function bookRoundTripCost(
  book: L2Book,
  side: 'buy' | 'sell',
  notionalUsd: number,
  takerFeeBpsPerLeg: number,
): BookRoundTrip | null {
  const entry = walkBook(book, side, notionalUsd)
  const exit = walkBook(book, side === 'buy' ? 'sell' : 'buy', notionalUsd)
  if (!entry || !exit) return null
  const exhausted = entry.exhausted || exit.exhausted
  return {
    entryImpactBps: entry.impactBps,
    exitImpactBps: exit.impactBps,
    takerFeeRoundTripBps: takerFeeBpsPerLeg * 2,
    allInBps: entry.impactBps + exit.impactBps + takerFeeBpsPerLeg * 2,
    exhausted,
    note:
      `Book walk of displayed liquidity: entry ${entry.impactBps.toFixed(2)} bps plus exit ` +
      `${exit.impactBps.toFixed(2)} bps plus taker ${(takerFeeBpsPerLeg * 2).toFixed(2)} bps.` +
      (exhausted ? ' Displayed book was exhausted before the full clip, so true cost is higher.' : ''),
  }
}

/** Strip a quote suffix so BTCUSDT resolves to the comparison venue's coin name. */
export function comparisonCoin(symbol: string): string {
  return symbol.replace(/(USDT|USDC|USD)$/i, '').toUpperCase()
}

export interface ReferenceMid {
  venueId: string
  coin: string
  mid: number
  bestBid: number
  bestAsk: number
  /** The reference venue's own displayed book spread, not Gryps spread. */
  displayedSpreadBps: number
}

export interface VenueQuote {
  venueId: string
  /** Indicative cost. Present but not executable when `exhausted` is true. */
  allInBps: number | null
  fixedCost: boolean
  /** False when this venue cannot actually fill the clip at the quoted cost. */
  eligible: boolean
  /** True when displayed depth ran out before the clip was filled. */
  exhausted?: boolean
  note: string
}

export interface ComparisonVenueOptions {
  apiUrl: string
  takerFeeBpsPerLeg: number
  timeoutMs: number
  fetcher?: typeof fetch
}

export class ComparisonVenue {
  readonly venueId = 'hyperliquid'
  private readonly fetcher: typeof fetch

  constructor(private readonly options: ComparisonVenueOptions) {
    this.fetcher = options.fetcher ?? fetch
  }

  private async book(symbol: string): Promise<L2Book | null> {
    const coin = comparisonCoin(symbol)
    const response = await this.fetcher(this.options.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ type: 'l2Book', coin }),
      redirect: 'error',
      signal: AbortSignal.timeout(this.options.timeoutMs),
    })
    if (!response.ok) throw new PublicMcpError('upstream_unavailable', `Comparison venue returned HTTP ${response.status}.`)
    const parsed = hlBookSchema.safeParse(await response.json())
    if (!parsed.success) return null
    const [bids, asks] = parsed.data.levels
    return {
      symbol,
      bids: bids.map((level) => ({ price: Number(level.px), size: Number(level.sz) })),
      asks: asks.map((level) => ({ price: Number(level.px), size: Number(level.sz) })),
    }
  }

  /**
   * Top-of-book reference mid. This is the external fair-value anchor used to
   * sanity-check the Gryps oracle and, later, to feed paper sessions. It is a
   * midpoint of displayed quotes, not a tradable price.
   */
  async referenceMid(symbol: string): Promise<ReferenceMid | null> {
    const book = await this.book(symbol)
    if (book === null) return null
    const bestBid = book.bids[0]?.price
    const bestAsk = book.asks[0]?.price
    const mid = bookMid(book)
    if (mid === null || bestBid === undefined || bestAsk === undefined) return null
    return {
      venueId: this.venueId,
      coin: comparisonCoin(symbol),
      mid,
      bestBid,
      bestAsk,
      displayedSpreadBps: ((bestAsk - bestBid) / mid) * 10_000,
    }
  }

  async quote(symbol: string, side: 'long' | 'short', notionalUsd: number): Promise<VenueQuote> {
    try {
      const book = await this.book(symbol)
      if (book === null) {
        return {
          venueId: this.venueId,
          allInBps: null,
          fixedCost: false,
          eligible: false,
          note: `${symbol} is not listed on this venue. Absence of a market is a real routing outcome, not an error.`,
        }
      }
      const roundTrip = bookRoundTripCost(
        book,
        side === 'long' ? 'buy' : 'sell',
        notionalUsd,
        this.options.takerFeeBpsPerLeg,
      )
      if (!roundTrip) {
        return {
          venueId: this.venueId,
          allInBps: null,
          fixedCost: false,
          eligible: false,
          note: 'The comparison venue returned an empty or unusable book.',
        }
      }
      return {
        venueId: this.venueId,
        allInBps: roundTrip.allInBps,
        fixedCost: false,
        // Displayed depth that cannot absorb the clip is not an executable price.
        eligible: !roundTrip.exhausted,
        exhausted: roundTrip.exhausted,
        note: roundTrip.note,
      }
    } catch {
      return {
        venueId: this.venueId,
        allInBps: null,
        fixedCost: false,
        eligible: false,
        note: 'The comparison venue was unreachable. Only the Gryps side of this comparison is available.',
      }
    }
  }
}

export interface RouteComparison {
  symbol: string
  side: 'long' | 'short'
  notionalUsd: number
  venues: VenueQuote[]
  cheapest: string | null
  spreadBetweenVenuesBps: number | null
  narration: string
  caveats: string[]
}

export function compareRoutes(
  symbol: string,
  side: 'long' | 'short',
  notionalUsd: number,
  friction: FrictionSample,
  comparison: VenueQuote,
): RouteComparison {
  const gryps: VenueQuote = {
    venueId: 'gryps-v2',
    allInBps: friction.quote.roundTripBps,
    fixedCost: true,
    eligible: true,
    note: friction.isLowerBound
      ? 'Quoted RFQ cost derived from the measured fee floor. Spread is unmeasured, so the true Gryps cost is higher than shown.'
      : 'Quoted RFQ cost derived from measured friction including operator-supplied spread.',
  }

  const venues = [gryps, comparison]
  const priced = venues.filter(
    (venue): venue is VenueQuote & { allInBps: number } =>
      venue.eligible && typeof venue.allInBps === 'number' && Number.isFinite(venue.allInBps),
  )
  const sorted = [...priced].sort((a, b) => a.allInBps - b.allInBps)
  const best = sorted[0] ?? null
  const runnerUp = sorted[1] ?? null

  const caveats: string[] = [...friction.limitations]
  if (friction.isLowerBound) {
    caveats.push(
      'The Gryps side is a lower bound and the comparison side includes measured book impact. This comparison flatters Gryps until spread is measured.',
    )
  }
  caveats.push('Displayed book liquidity is not the same as executable liquidity.')
  if (comparison.exhausted) {
    caveats.push(
      'The comparison venue was ranked out because its displayed depth could not fill the clip, not because its quoted rate was worse. Its true cost at this size is higher than the number shown.',
    )
  } else if (!comparison.eligible) {
    caveats.push('The comparison venue could not price this clip, so no ranking was possible.')
  }

  let narration: string
  if (!best) {
    narration = 'No venue could price this clip.'
  } else if (!runnerUp && comparison.exhausted && typeof comparison.allInBps === 'number') {
    // The comparison venue quoted a cheaper-looking number it cannot actually fill.
    narration =
      `${best.venueId} is the only venue that can execute this clip at ${best.allInBps.toFixed(1)} bps. ` +
      `${comparison.venueId} shows ${comparison.allInBps.toFixed(1)} bps, but its displayed book ran out before ` +
      `${notionalUsd.toLocaleString('en-US')} USD was filled, so that price is indicative and not executable at this size. ` +
      'This is the size at which a quoted RFQ cost starts to beat a lit book.'
  } else if (!runnerUp) {
    narration =
      `Only ${best.venueId} could price this clip, at ${best.allInBps.toFixed(1)} bps round trip. ` +
      `${comparison.note}`
  } else {
    narration =
      `${best.venueId} is cheaper for a ${notionalUsd.toLocaleString('en-US')} USD ${side} in ${symbol}: ` +
      `${best.allInBps.toFixed(1)} bps against ${runnerUp.allInBps.toFixed(1)} bps, a difference of ` +
      `${(runnerUp.allInBps - best.allInBps).toFixed(1)} bps. ` +
      'Gryps cost is quoted and does not grow with clip size; book cost does.'
  }

  return {
    symbol,
    side,
    notionalUsd,
    venues,
    cheapest: best?.venueId ?? null,
    spreadBetweenVenuesBps: best && runnerUp ? runnerUp.allInBps - best.allInBps : null,
    narration,
    caveats,
  }
}
