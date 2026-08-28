import type { ZodType } from 'zod'
import type { PublicMcpConfig } from './config.js'
import { PACKAGE_NAME, PACKAGE_VERSION } from './constants.js'
import { PublicMcpError } from './errors.js'
import {
  configSchema,
  healthSchema,
  marketsResponseSchema,
  pricesResponseSchema,
  riskConfigSchema,
  type ConfigResponse,
  type HealthResponse,
  type MarketRecord,
  type PriceRecord,
  type RiskConfig,
} from './schemas.js'

interface CacheEntry {
  expiresAt: number
  value: unknown
}

export interface EngineReadClientOptions {
  config: PublicMcpConfig
  fetcher?: typeof fetch
  nowMs?: () => number
}

function safeSource(raw: string): string {
  const url = new URL(raw)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.toString()
}

export class EngineReadClient {
  private readonly fetcher: typeof fetch
  private readonly nowMs: () => number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(private readonly options: EngineReadClientOptions) {
    this.fetcher = options.fetcher ?? fetch
    this.nowMs = options.nowMs ?? Date.now
  }

  get apiSource(): string {
    return safeSource(this.options.config.apiBase)
  }

  get healthSource(): string {
    return safeSource(this.options.config.healthUrl)
  }

  private async get<T>(url: string, schema: ZodType<T>): Promise<T> {
    const now = this.nowMs()
    const cached = this.cache.get(url)
    if (cached && cached.expiresAt > now) return cached.value as T

    const pending = this.inflight.get(url)
    if (pending) return pending as Promise<T>

    const request = (async () => {
      let response: Response
      try {
        response = await this.fetcher(url, {
          method: 'GET',
          headers: { accept: 'application/json', 'user-agent': `${PACKAGE_NAME}/${PACKAGE_VERSION}` },
          redirect: 'error',
          signal: AbortSignal.timeout(this.options.config.timeoutMs),
        })
      } catch {
        throw new PublicMcpError('upstream_unavailable', 'The live Gryps read endpoint is unavailable.')
      }
      if (!response.ok) {
        throw new PublicMcpError(
          'upstream_unavailable',
          `The live Gryps read endpoint returned HTTP ${response.status}.`,
        )
      }

      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new PublicMcpError(
          'upstream_schema_mismatch',
          'The live Gryps endpoint did not return valid JSON.',
        )
      }
      const value = schema.parse(body)
      this.cache.set(url, {
        value,
        expiresAt: this.nowMs() + this.options.config.cacheTtlMs,
      })
      return value
    })().finally(() => this.inflight.delete(url))

    this.inflight.set(url, request)
    return request
  }

  async health(): Promise<HealthResponse> {
    return this.get(this.options.config.healthUrl, healthSchema)
  }

  async config(): Promise<ConfigResponse> {
    return this.get(`${this.options.config.apiBase}/config`, configSchema)
  }

  async markets(): Promise<MarketRecord[]> {
    const response = await this.get(`${this.options.config.apiBase}/markets`, marketsResponseSchema)
    return Array.isArray(response) ? response : response.markets
  }

  async prices(): Promise<PriceRecord[]> {
    const response = await this.get(`${this.options.config.apiBase}/prices`, pricesResponseSchema)
    return response.prices
  }

  async riskConfig(): Promise<RiskConfig> {
    return this.get(`${this.options.config.apiBase}/risk-config`, riskConfigSchema)
  }
}
