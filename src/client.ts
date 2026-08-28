import type { ZodType } from 'zod'
import type { PublicMcpConfig } from './config.js'
import {
  CACHE_MAX_ENTRIES,
  DEFAULT_RETRY_DELAY_MS,
  MAX_UPSTREAM_RESPONSE_BYTES,
  PACKAGE_NAME,
  PACKAGE_VERSION,
  UPSTREAM_MAX_RETRIES,
} from './constants.js'
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
  retryDelayMs?: number
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

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
  private readonly retryDelayMs: number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(private readonly options: EngineReadClientOptions) {
    this.fetcher = options.fetcher ?? fetch
    this.nowMs = options.nowMs ?? Date.now
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
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
      const value = schema.parse(await this.fetchJson(url))
      this.cache.set(url, {
        value,
        expiresAt: this.nowMs() + this.options.config.cacheTtlMs,
      })
      while (this.cache.size > CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value
        if (oldest === undefined) break
        this.cache.delete(oldest)
      }
      return value
    })().finally(() => this.inflight.delete(url))

    this.inflight.set(url, request)
    return request
  }

  private async fetchJson(url: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.fetchJsonOnce(url)
      } catch (error) {
        const retryable = error instanceof PublicMcpError && error.retryable
        if (!retryable || attempt >= UPSTREAM_MAX_RETRIES) throw error
        if (this.retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs))
        }
      }
    }
  }

  private async fetchJsonOnce(url: string): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': `${PACKAGE_NAME}/${PACKAGE_VERSION}` },
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.config.timeoutMs),
      })
    } catch {
      throw new PublicMcpError('upstream_unavailable', 'The live Gryps read endpoint is unavailable.', {
        retryable: true,
      })
    }
    if (!response.ok) {
      throw new PublicMcpError(
        'upstream_unavailable',
        `The live Gryps read endpoint returned HTTP ${response.status}.`,
        { retryable: RETRYABLE_STATUSES.has(response.status) },
      )
    }

    let text: string
    try {
      text = await response.text()
    } catch {
      throw new PublicMcpError('upstream_unavailable', 'The live Gryps read endpoint closed the connection early.', {
        retryable: true,
      })
    }
    if (text.length > MAX_UPSTREAM_RESPONSE_BYTES) {
      throw new PublicMcpError(
        'upstream_schema_mismatch',
        'The live Gryps endpoint returned an oversized response.',
      )
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new PublicMcpError(
        'upstream_schema_mismatch',
        'The live Gryps endpoint did not return valid JSON.',
      )
    }
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
