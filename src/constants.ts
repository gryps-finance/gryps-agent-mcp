import { readFileSync } from 'node:fs'

const packageMetadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name?: unknown; version?: unknown }

if (typeof packageMetadata.name !== 'string' || typeof packageMetadata.version !== 'string') {
  throw new Error('package.json must contain string name and version fields')
}

export const PACKAGE_NAME = packageMetadata.name
export const PACKAGE_VERSION = packageMetadata.version
export const SERVER_NAME = 'gryps-agent-mcp'
export const RESPONSE_SCHEMA_VERSION = '1.0'

export const DEFAULT_API_BASE = 'https://perps-api.orbs.network/api/v1'
export const DEFAULT_HEALTH_URL = 'https://perps-api.orbs.network/health'
export const DEFAULT_TIMEOUT_MS = 10_000
export const DEFAULT_CACHE_TTL_MS = 10_000
export const DEFAULT_RETRY_DELAY_MS = 250
export const UPSTREAM_MAX_RETRIES = 1
export const MAX_UPSTREAM_RESPONSE_BYTES = 5_000_000
export const CACHE_MAX_ENTRIES = 32

export const PRICE_SCALE = 1_000_000

/**
 * Public order-book venue used for cost comparison. Keyless and read-only.
 * Comparison is opt-out so the router can always answer "is Gryps actually
 * the cheaper route", including when the answer is no.
 */
export const DEFAULT_COMPARISON_URL = 'https://api.hyperliquid.xyz/info'

/**
 * Taker fee assumed for the comparison venue, per leg, in basis points. This is
 * an assumption, not a measurement: it is tier-dependent and changes. It is
 * overridable and every response states the value used.
 */
export const DEFAULT_COMPARISON_TAKER_FEE_BPS = 4.5

export const PUBLIC_TOOL_NAMES = [
  'gryps_list_markets',
  'gryps_get_market',
  'gryps_venue_status',
  'gryps_friction_floor',
  'gryps_get_fee_schedule',
  'gryps_edge_check',
  'gryps_signal_stack',
  'gryps_route_compare',
  'gryps_indicative_quote',
  'gryps_reference_price',
  'gryps_next_step',
  'gryps_prompt_library',
  'gryps_paper_session',
  'gryps_capabilities',
] as const

export type PublicToolName = (typeof PUBLIC_TOOL_NAMES)[number]

/**
 * Canonical Gryps v2 settlement identity, verified against the live engine on
 * 2026-08-28. The engine reports its own chain and contract; this server
 * compares that report against these pinned values instead of relaying it. A
 * relayed identity proves nothing, because a wrong or hostile endpoint relays
 * its own answer with exactly the same confidence.
 */
export const CANONICAL_SETTLEMENT = {
  chainId: 137,
  chainName: 'polygon',
  contract: '0xc206B7725e6E6631516b4feA100F8A07Bbc736Ee',
  collateralToken: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  verifiedAtIso: '2026-08-28',
} as const

/**
 * Record of the search for a bid/ask or depth surface on the public v2 engine.
 * Spread cannot be measured until one of these exists, so the friction floor
 * stays a fee floor. This is a probe result, not an assumption: every path
 * below returned 404 on the date recorded.
 */
export const SPREAD_SURFACE_PROBE = {
  probedAtIso: '2026-08-28',
  found: false,
  endpointsProbed: [
    'orderbook',
    'orderbook/{symbol}',
    'book',
    'book/{symbol}',
    'l2book',
    'depth',
    'depth/{symbol}',
    'ticker',
    'ticker/{symbol}',
    'tickers',
    'quote',
    'quotes',
    'spread',
    'trades',
  ],
  reachableSurfaces: ['config', 'markets', 'prices', 'risk-config', 'market-data'],
  note:
    'No bid/ask or depth surface exists on the public v2 engine. Spread is absent upstream, ' +
    'not merely unwired here. It cannot be measured from this package until the engine ships one.',
} as const
