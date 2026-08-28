import {
  DEFAULT_API_BASE,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_COMPARISON_TAKER_FEE_BPS,
  DEFAULT_COMPARISON_URL,
  DEFAULT_HEALTH_URL,
  DEFAULT_TIMEOUT_MS,
} from './constants.js'
import { PublicMcpError } from './errors.js'

export interface PublicMcpConfig {
  apiBase: string
  healthUrl: string
  timeoutMs: number
  cacheTtlMs: number
  comparisonUrl: string | null
  comparisonTakerFeeBps: number
  /**
   * Direction of the engine fee rate, once confirmed. Undefined means the
   * question is still open and the conservative per-side reading is assumed;
   * false means confirmed per side. The distinction is reported to callers.
   */
  feeIsRoundTrip: boolean | undefined
  /** Operator-measured spread per side, in bps. Absent means spread is unmeasured. */
  spreadBpsPerSide: number | undefined
}

const KNOWN_ARGUMENTS = [
  'api-base',
  'health-url',
  'timeout-ms',
  'cache-ttl-ms',
  'comparison-url',
  'comparison-taker-fee-bps',
  'fee-is-round-trip',
  'spread-bps-per-side',
] as const

function validateEndpoint(raw: string, label: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PublicMcpError('invalid_configuration', `${label} must be a valid URL.`)
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new PublicMcpError(
      'invalid_configuration',
      `${label} must use HTTPS. HTTP is accepted only for a loopback development address.`,
    )
  }
  if (url.username || url.password) {
    throw new PublicMcpError('invalid_configuration', `${label} must not contain credentials.`)
  }
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function positiveInteger(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0 || value > 60_000) {
    throw new PublicMcpError('invalid_configuration', `${label} must be an integer from 1 to 60000.`)
  }
  return value
}

function nonNegativeRate(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 10_000) {
    throw new PublicMcpError('invalid_configuration', `${label} must be a number from 0 to 10000 basis points.`)
  }
  return value
}

function booleanFlag(raw: string | undefined, label: string): boolean | undefined {
  if (raw === undefined) return undefined
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new PublicMcpError('invalid_configuration', `${label} must be "true" or "false".`)
}

export function parseConfig(args: string[]): PublicMcpConfig {
  const parsed = new Map<string, string>()
  for (const arg of args) {
    if (!arg.startsWith('--') || !arg.includes('=')) {
      throw new PublicMcpError(
        'invalid_configuration',
        `Unknown argument "${arg}". Known arguments: ${KNOWN_ARGUMENTS.map((name) => `--${name}=`).join(', ')}.`,
      )
    }
    const [key, ...valueParts] = arg.slice(2).split('=')
    if (!key || valueParts.length === 0) {
      throw new PublicMcpError('invalid_configuration', `Invalid argument "${arg}".`)
    }
    if (!(KNOWN_ARGUMENTS as readonly string[]).includes(key)) {
      throw new PublicMcpError('invalid_configuration', `Unknown argument "--${key}".`)
    }
    parsed.set(key, valueParts.join('='))
  }

  const rawComparison = parsed.get('comparison-url')
  const comparisonUrl =
    rawComparison === 'off' ? null : validateEndpoint(rawComparison ?? DEFAULT_COMPARISON_URL, 'comparison-url')

  const rawSpread = parsed.get('spread-bps-per-side')

  return {
    apiBase: validateEndpoint(parsed.get('api-base') ?? DEFAULT_API_BASE, 'api-base'),
    healthUrl: validateEndpoint(parsed.get('health-url') ?? DEFAULT_HEALTH_URL, 'health-url'),
    timeoutMs: positiveInteger(parsed.get('timeout-ms'), DEFAULT_TIMEOUT_MS, 'timeout-ms'),
    cacheTtlMs: positiveInteger(parsed.get('cache-ttl-ms'), DEFAULT_CACHE_TTL_MS, 'cache-ttl-ms'),
    comparisonUrl,
    comparisonTakerFeeBps: nonNegativeRate(
      parsed.get('comparison-taker-fee-bps'),
      DEFAULT_COMPARISON_TAKER_FEE_BPS,
      'comparison-taker-fee-bps',
    ),
    feeIsRoundTrip: booleanFlag(parsed.get('fee-is-round-trip'), 'fee-is-round-trip'),
    spreadBpsPerSide: rawSpread === undefined ? undefined : nonNegativeRate(rawSpread, 0, 'spread-bps-per-side'),
  }
}

export function defaultConfig(): PublicMcpConfig {
  return parseConfig([])
}
