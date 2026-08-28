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

export const PUBLIC_TOOL_NAMES = [
  'gryps_list_markets',
  'gryps_get_market',
  'gryps_get_fee_schedule',
  'gryps_venue_status',
] as const

export type PublicToolName = (typeof PUBLIC_TOOL_NAMES)[number]
