import {
  DEFAULT_API_BASE,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_HEALTH_URL,
  DEFAULT_TIMEOUT_MS,
} from './constants.js'
import { PublicMcpError } from './errors.js'

export interface PublicMcpConfig {
  apiBase: string
  healthUrl: string
  timeoutMs: number
  cacheTtlMs: number
}

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

export function parseConfig(args: string[]): PublicMcpConfig {
  const parsed = new Map<string, string>()
  for (const arg of args) {
    if (!arg.startsWith('--') || !arg.includes('=')) {
      throw new PublicMcpError(
        'invalid_configuration',
        `Unknown argument "${arg}". Use --api-base=, --health-url=, --timeout-ms=, or --cache-ttl-ms=.`,
      )
    }
    const [key, ...valueParts] = arg.slice(2).split('=')
    if (!key || valueParts.length === 0) {
      throw new PublicMcpError('invalid_configuration', `Invalid argument "${arg}".`)
    }
    if (!['api-base', 'health-url', 'timeout-ms', 'cache-ttl-ms'].includes(key)) {
      throw new PublicMcpError('invalid_configuration', `Unknown argument "--${key}".`)
    }
    parsed.set(key, valueParts.join('='))
  }

  return {
    apiBase: validateEndpoint(parsed.get('api-base') ?? DEFAULT_API_BASE, 'api-base'),
    healthUrl: validateEndpoint(parsed.get('health-url') ?? DEFAULT_HEALTH_URL, 'health-url'),
    timeoutMs: positiveInteger(parsed.get('timeout-ms'), DEFAULT_TIMEOUT_MS, 'timeout-ms'),
    cacheTtlMs: positiveInteger(parsed.get('cache-ttl-ms'), DEFAULT_CACHE_TTL_MS, 'cache-ttl-ms'),
  }
}

export function defaultConfig(): PublicMcpConfig {
  return parseConfig([])
}
