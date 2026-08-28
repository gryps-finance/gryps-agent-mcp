import type { ZodType } from 'zod'
import type { ObserverConfig } from './config.js'
import {
  accountSnapshotSchema,
  ordersSchema,
  portfolioSchema,
  tradesSchema,
  type AccountSnapshot,
  type OrdersPage,
  type Portfolio,
  type TradesPage,
} from './schemas.js'

interface CacheEntry {
  expiresAt: number
  value: unknown
}

const CACHE_MAX_ENTRIES = 64
const MAX_UPSTREAM_RESPONSE_BYTES = 5_000_000
const MAX_PAGE_LIMIT = 100
const MAX_PAGE_OFFSET = 100_000

export class ObserverUpstreamError extends Error {
  constructor(readonly code: 'upstream_unavailable' | 'upstream_schema_mismatch', message: string) {
    super(message)
    this.name = 'ObserverUpstreamError'
  }
}

function boundedPage(limit: number, offset: number): { limit: number; offset: number } {
  return {
    limit: Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_LIMIT),
    offset: Math.min(Math.max(Math.trunc(offset), 0), MAX_PAGE_OFFSET),
  }
}

export class AccountReadClient {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(
    private readonly config: ObserverConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly nowMs: () => number = Date.now,
  ) {}

  private async get<T>(path: string, schema: ZodType<T>): Promise<T> {
    const url = `${this.config.apiBase}${path}`
    const cached = this.cache.get(url)
    if (cached && cached.expiresAt > this.nowMs()) return cached.value as T

    const pending = this.inflight.get(url)
    if (pending) return pending as Promise<T>

    const request = (async () => {
      const parsed = schema.safeParse(await this.fetchJson(url))
      if (!parsed.success) {
        throw new ObserverUpstreamError(
          'upstream_schema_mismatch',
          'The Gryps account endpoint returned an unexpected response shape.',
        )
      }
      this.cache.set(url, { value: parsed.data, expiresAt: this.nowMs() + this.config.cacheTtlMs })
      while (this.cache.size > CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value
        if (oldest === undefined) break
        this.cache.delete(oldest)
      }
      return parsed.data
    })().finally(() => this.inflight.delete(url))

    this.inflight.set(url, request)
    return request as Promise<T>
  }

  private async fetchJson(url: string): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'gryps-agent-mcp-internal-observer/0.1' },
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      })
    } catch {
      throw new ObserverUpstreamError('upstream_unavailable', 'The Gryps account endpoint is unavailable.')
    }
    if (!response.ok) {
      throw new ObserverUpstreamError(
        'upstream_unavailable',
        `The Gryps account endpoint returned HTTP ${response.status}.`,
      )
    }

    let text: string
    try {
      text = await response.text()
    } catch {
      throw new ObserverUpstreamError('upstream_unavailable', 'The Gryps account endpoint closed the connection early.')
    }
    if (text.length > MAX_UPSTREAM_RESPONSE_BYTES) {
      throw new ObserverUpstreamError('upstream_schema_mismatch', 'The Gryps account endpoint returned an oversized response.')
    }
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw new ObserverUpstreamError('upstream_schema_mismatch', 'The Gryps account endpoint returned invalid JSON.')
    }
  }

  snapshot(): Promise<AccountSnapshot> {
    return this.get(`/user/${this.config.accountAddress}`, accountSnapshotSchema)
  }

  portfolio(): Promise<Portfolio> {
    return this.get(`/user/${this.config.accountAddress}/portfolio`, portfolioSchema)
  }

  orders(limit: number, offset: number): Promise<OrdersPage> {
    const page = boundedPage(limit, offset)
    return this.get(
      `/user/${this.config.accountAddress}/orders/history?limit=${page.limit}&offset=${page.offset}`,
      ordersSchema,
    )
  }

  trades(limit: number, offset: number): Promise<TradesPage> {
    const page = boundedPage(limit, offset)
    return this.get(
      `/user/${this.config.accountAddress}/trades?limit=${page.limit}&offset=${page.offset}`,
      tradesSchema,
    )
  }
}
