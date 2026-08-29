import type { PublicMcpConfig } from '../src/config.js'

export const testConfig: PublicMcpConfig = {
  apiBase: 'https://example.test/api/v1',
  healthUrl: 'https://example.test/health',
  timeoutMs: 1_000,
  cacheTtlMs: 10_000,
  comparisonUrl: 'https://book.example.test/info',
  explorerUrl: 'https://explorer.example.test/api/v2',
  comparisonTakerFeeBps: 4.5,
  feeIsRoundTrip: undefined,
  spreadBpsPerSide: undefined,
}

/** A minimal two-level order book for the comparison venue. */
export const comparisonBook = {
  levels: [
    [
      { px: '79600', sz: '5' },
      { px: '79500', sz: '50' },
    ],
    [
      { px: '79650', sz: '5' },
      { px: '79750', sz: '50' },
    ],
  ],
}

export const fixtureBodies: Record<string, unknown> = {
  '/health': {
    build: 'v4.2.0+test',
    gitCommit: 'abc123',
    status: 'healthy',
    timestamp: '2026-08-28T10:00:00Z',
    version: 'v4.2.0',
  },
  '/api/v1/config': {
    chainId: 137,
    contractAddress: '0x0000000000000000000000000000000000000137',
  },
  '/api/v1/markets': {
    markets: [
      {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        quoteAsset: 'USDT',
        displayName: 'BTC/USDT',
        pricePrecision: 2,
        quantityPrecision: 3,
      },
      {
        symbol: 'PUMPBTCUSDT',
        baseAsset: 'PUMPBTC',
        quoteAsset: 'USDT',
        displayName: 'PUMPBTC/USDT',
        pricePrecision: 6,
        quantityPrecision: 0,
      },
    ],
  },
  '/api/v1/prices': {
    prices: [
      { symbol: 'BTCUSDT', price: '79620600000', timestamp: 1_787_915_570_000 },
      { symbol: 'PUMPBTCUSDT', price: '123456', timestamp: 1_787_915_570_000 },
    ],
  },
  '/api/v1/risk-config': {
    symbols: {
      BTCUSDT: {
        defaultLeverage: 20,
        maxLeverage: 75,
        mmBrackets: [{ maxNotional: '5000000000', mmrBps: 100, cum: '0', maxLeverage: 75 }],
      },
      PUMPBTCUSDT: {
        defaultLeverage: 5,
        maxLeverage: 10,
        mmBrackets: [{ maxNotional: '1000000000', mmrBps: 500, cum: '0', maxLeverage: 10 }],
      },
    },
    feeTiers: [
      { tierLevel: 0, totalFeeRateBps: 12 },
      { tierLevel: 9, totalFeeRateBps: 0 },
    ],
  },
}

export function fixtureFetch(overrides: Record<string, unknown> = {}): typeof fetch {
  const bodies = { ...fixtureBodies, ...overrides }
  return (async (input: string | URL | Request) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    const body = bodies[url.pathname]
    if (body === undefined) return new Response(JSON.stringify({ message: 'missing fixture' }), { status: 404 })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}
