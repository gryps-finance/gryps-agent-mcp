const DEFAULT_API_BASE = 'https://perps-api.orbs.network/api/v1'

export interface ObserverConfig {
  accountAddress: string
  apiBase: string
  cacheTtlMs: number
  timeoutMs: number
}

export class ObserverConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ObserverConfigurationError'
  }
}

function endpoint(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ObserverConfigurationError('api-base must be a valid URL.')
  }
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ObserverConfigurationError('api-base must use HTTPS, except on loopback.')
  }
  if (url.username || url.password) {
    throw new ObserverConfigurationError('api-base must not contain credentials.')
  }
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

function positiveInteger(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 60_000) {
    throw new ObserverConfigurationError(`${label} must be an integer from 1 to 60000.`)
  }
  return value
}

export function parseObserverConfig(args: string[]): ObserverConfig {
  const values = new Map<string, string>()
  for (const argument of args) {
    if (!argument.startsWith('--') || !argument.includes('=')) {
      throw new ObserverConfigurationError(`Unknown argument "${argument}".`)
    }
    const [key, ...parts] = argument.slice(2).split('=')
    if (!key || parts.length === 0 || !['account-address', 'api-base', 'timeout-ms', 'cache-ttl-ms'].includes(key)) {
      throw new ObserverConfigurationError(`Unknown argument "${argument}".`)
    }
    values.set(key, parts.join('='))
  }

  const accountAddress = values.get('account-address')
  if (!accountAddress || !/^0x[0-9a-fA-F]{40}$/.test(accountAddress)) {
    throw new ObserverConfigurationError('account-address must be one 20-byte EVM address.')
  }

  return {
    accountAddress,
    apiBase: endpoint(values.get('api-base') ?? DEFAULT_API_BASE),
    timeoutMs: positiveInteger(values.get('timeout-ms'), 10_000, 'timeout-ms'),
    cacheTtlMs: positiveInteger(values.get('cache-ttl-ms'), 5_000, 'cache-ttl-ms'),
  }
}
