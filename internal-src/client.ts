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

export class ObserverUpstreamError extends Error {
  constructor(readonly code: 'upstream_unavailable' | 'upstream_schema_mismatch', message: string) {
    super(message)
    this.name = 'ObserverUpstreamError'
  }
}

export class AccountReadClient {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly config: ObserverConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly nowMs: () => number = Date.now,
  ) {}

  private async get<T>(path: string, schema: ZodType<T>): Promise<T> {
    const url = `${this.config.apiBase}${path}`
    const cached = this.cache.get(url)
    if (cached && cached.expiresAt > this.nowMs()) return cached.value as T

    let response: Response
    try {
      response = await this.fetcher(url, {
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': '@gryps/agent-mcp-internal-observer/0.1' },
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

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new ObserverUpstreamError('upstream_schema_mismatch', 'The Gryps account endpoint returned invalid JSON.')
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new ObserverUpstreamError(
        'upstream_schema_mismatch',
        'The Gryps account endpoint returned an unexpected response shape.',
      )
    }
    this.cache.set(url, { value: parsed.data, expiresAt: this.nowMs() + this.config.cacheTtlMs })
    return parsed.data
  }

  snapshot(): Promise<AccountSnapshot> {
    return this.get(`/user/${this.config.accountAddress}`, accountSnapshotSchema)
  }

  portfolio(): Promise<Portfolio> {
    return this.get(`/user/${this.config.accountAddress}/portfolio`, portfolioSchema)
  }

  orders(limit: number, offset: number): Promise<OrdersPage> {
    return this.get(
      `/user/${this.config.accountAddress}/orders/history?limit=${limit}&offset=${offset}`,
      ordersSchema,
    )
  }

  trades(limit: number, offset: number): Promise<TradesPage> {
    return this.get(`/user/${this.config.accountAddress}/trades?limit=${limit}&offset=${offset}`, tradesSchema)
  }
}
