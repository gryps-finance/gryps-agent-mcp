/**
 * Symbol discovery. The first call any agent makes is "what is this thing
 * called here", and it used to fail on the most obvious input: a search for
 * "bitcoin" returned nothing, because the catalogue only knows `BTCUSDT`.
 *
 * Three layers, in order, each one narrower about what it claims:
 *
 * 1. A curated alias table. Exact-keyed, hand-checked against the live
 *    catalogue, and deliberately small. An alias rewrites the query and nothing
 *    else: it never asserts that the market exists. `matic` resolves to `POL`
 *    because that is what the venue lists, and `toncoin` resolves to nothing
 *    because the venue does not list it.
 * 2. Substring matching, for browsing.
 * 3. Edit-distance suggestions, for when both of those come back empty. These
 *    are labelled as guesses everywhere they surface, and are never used to
 *    resolve a symbol — only to tell a caller what it might have meant.
 */

/** Uppercase and strip the separators people put in pair names. */
export function normalise(value: string): string {
  return value.trim().toUpperCase().replace(/[\s/_-]/g, '')
}

/**
 * Common names mapped to the base asset the venue actually lists. Every target
 * was checked against the live catalogue on 2026-08-29; where the venue lists a
 * renamed or multiplied ticker, the alias points at the venue's name, not the
 * one the caller is likely to remember.
 */
export const SYMBOL_ALIASES: Readonly<Record<string, string>> = {
  BITCOIN: 'BTC',
  XBT: 'BTC',
  BITCOINCASH: 'BCH',
  ETHEREUM: 'ETH',
  ETHER: 'ETH',
  SOLANA: 'SOL',
  RIPPLE: 'XRP',
  DOGECOIN: 'DOGE',
  CARDANO: 'ADA',
  AVALANCHE: 'AVAX',
  POLKADOT: 'DOT',
  CHAINLINK: 'LINK',
  LITECOIN: 'LTC',
  // The venue lists POL, not MATIC. An agent that remembers MATIC is not wrong,
  // it is just out of date, and a zero-result search will not tell it that.
  POLYGON: 'POL',
  MATIC: 'POL',
  BINANCECOIN: 'BNB',
  TRON: 'TRX',
  SHIBAINU: 'SHIB',
  ARBITRUM: 'ARB',
  OPTIMISM: 'OP',
  APTOS: 'APT',
  NEARPROTOCOL: 'NEAR',
  COSMOS: 'ATOM',
  FILECOIN: 'FIL',
  INTERNETCOMPUTER: 'ICP',
  HEDERA: 'HBAR',
  STELLAR: 'XLM',
  ETHEREUMCLASSIC: 'ETC',
  UNISWAP: 'UNI',
  INJECTIVE: 'INJ',
  CELESTIA: 'TIA',
  WORLDCOIN: 'WLD',
  ETHENA: 'ENA',
  JUPITER: 'JUP',
  PUDGYPENGUINS: 'PENGU',
  HYPERLIQUID: 'HYPE',
  KASPA: 'KAS',
  // RNDR was renamed to RENDER; the venue uses the new ticker.
  RNDR: 'RENDER',
  BITTENSOR: 'TAO',
  FETCHAI: 'FET',
  THEGRAPH: 'GRT',
  ALGORAND: 'ALGO',
  VECHAIN: 'VET',
  STACKS: 'STX',
  IMMUTABLE: 'IMX',
  DECENTRALAND: 'MANA',
  AXIEINFINITY: 'AXS',
  MONERO: 'XMR',
  ZCASH: 'ZEC',
  PANCAKESWAP: 'CAKE',
  CURVE: 'CRV',
  LIDO: 'LDO',
  SYNTHETIX: 'SNX',
  LAYERZERO: 'ZRO',
  STARKNET: 'STRK',
  MULTIVERSX: 'EGLD',
  ELROND: 'EGLD',
  SONIC: 'S',
}

export interface QueryExpansion {
  /** The caller's text, normalised. */
  requested: string
  /** What was actually searched for. */
  searched: string
  /** Set when the alias table rewrote the query. */
  aliasApplied: string | null
}

export function expandQuery(raw: string): QueryExpansion {
  const requested = normalise(raw)
  const alias = SYMBOL_ALIASES[requested]
  return {
    requested,
    searched: alias ?? requested,
    aliasApplied: alias ?? null,
  }
}

/** Levenshtein distance. Small inputs only; symbols are short by construction. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      const deletion = (previous[j] ?? 0) + 1
      const insertion = (current[j - 1] ?? 0) + 1
      current[j] = Math.min(substitution, deletion, insertion)
    }
    previous = current
  }
  return previous[b.length] ?? Math.max(a.length, b.length)
}

export interface NamedMarket {
  symbol: string
  baseAsset: string
  displayName: string
  quoteAsset: string
}

/** Fields a query is allowed to match against, normalised once. */
function searchableFields(market: NamedMarket): string[] {
  return [market.symbol, market.baseAsset, market.quoteAsset, market.displayName].map(normalise)
}

/**
 * Rank a substring hit by how squarely it answers to the query. A search for
 * BTC matches PUMPBTCUSDT as surely as BTCUSDT, and an agent reading the first
 * row should get the one it meant.
 */
export function relevanceRank(market: NamedMarket, searched: string): number {
  const symbol = normalise(market.symbol)
  const base = normalise(market.baseAsset)
  if (symbol === searched || base === searched) return 0
  if (symbol.startsWith(searched) || base.startsWith(searched)) return 1
  return 2
}

export function matchesSubstring(market: NamedMarket, searched: string): boolean {
  return searchableFields(market).some((field) => field.includes(searched))
}

/**
 * Best edit distance from the query to any name this market answers to, with a
 * discount for a shared prefix so that "BTCUSD" ranks `BTCUSDT` above an
 * unrelated symbol the same distance away.
 */
function suggestionScore(market: NamedMarket, searched: string): number {
  let best = Number.POSITIVE_INFINITY
  for (const field of searchableFields(market)) {
    const distance = editDistance(searched, field)
    const prefixBonus = field.startsWith(searched) || searched.startsWith(field) ? 1 : 0
    best = Math.min(best, distance - prefixBonus)
  }
  return best
}

export interface Suggestion<T> {
  market: T
  distance: number
}

/**
 * Nearest listed markets to a query that matched nothing. Ranked, bounded, and
 * always presented as a guess. Deterministic ties break on symbol so the same
 * query always returns the same order.
 */
export function nearestMarkets<T extends NamedMarket>(
  markets: readonly T[],
  searched: string,
  limit = 5,
): Suggestion<T>[] {
  // Anything further away than this is not a typo, it is a different word.
  // Kept tight on purpose: a loose bound turns "toncoin", which the venue
  // genuinely does not list, into a confident list of unrelated markets.
  const tolerance = Math.max(1, Math.floor(searched.length / 3))
  return markets
    .map((market) => ({ market, distance: suggestionScore(market, searched) }))
    .filter((candidate) => candidate.distance <= tolerance)
    .sort((a, b) => a.distance - b.distance || a.market.symbol.localeCompare(b.market.symbol))
    .slice(0, limit)
}
