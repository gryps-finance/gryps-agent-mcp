import { PRICE_SCALE, RESPONSE_SCHEMA_VERSION } from './constants.js'
import { EngineReadClient } from './client.js'
import { PublicMcpError } from './errors.js'
import type { MarketRecord } from './schemas.js'

interface EnvelopeMeta {
  fetchedAt: string
  readOnly: true
  source: string[]
  limitations: string[]
}

export interface SuccessEnvelope<T> {
  schemaVersion: string
  status: 'ok'
  data: T
  meta: EnvelopeMeta
}

function envelope<T>(data: T, source: string[], limitations: string[] = []): SuccessEnvelope<T> {
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    status: 'ok',
    data,
    meta: {
      fetchedAt: new Date().toISOString(),
      readOnly: true,
      source,
      limitations,
    },
  }
}

function normalise(value: string): string {
  return value.trim().toUpperCase().replace(/[\s/_-]/g, '')
}

export function resolveMarket(markets: MarketRecord[], requested: string): MarketRecord {
  const target = normalise(requested)
  const exactSymbol = markets.find((market) => normalise(market.symbol) === target)
  if (exactSymbol) return exactSymbol

  const exactDisplay = markets.filter((market) => normalise(market.displayName) === target)
  if (exactDisplay.length === 1 && exactDisplay[0]) return exactDisplay[0]

  const exactBase = markets.filter((market) => normalise(market.baseAsset) === target)
  if (exactBase.length === 1 && exactBase[0]) return exactBase[0]
  if (exactBase.length > 1) {
    throw new PublicMcpError(
      'ambiguous_symbol',
      `"${requested}" matches more than one quote market. Use the full canonical symbol.`,
    )
  }

  throw new PublicMcpError(
    'not_found',
    `No exact Gryps v2 market was found for "${requested}". Use gryps_list_markets to find the canonical symbol.`,
  )
}

export class PublicReadService {
  constructor(private readonly client: EngineReadClient) {}

  async listMarkets(input: { query?: string; limit: number; offset: number }) {
    const markets = (await this.client.markets()).slice().sort((a, b) => a.symbol.localeCompare(b.symbol))
    const query = input.query ? normalise(input.query) : null
    const filtered = query
      ? markets.filter((market) =>
          [market.symbol, market.baseAsset, market.quoteAsset, market.displayName]
            .map(normalise)
            .some((value) => value.includes(query)),
        )
      : markets
    return envelope(
      {
        total: filtered.length,
        offset: input.offset,
        limit: input.limit,
        markets: filtered.slice(input.offset, input.offset + input.limit),
      },
      [`${this.client.apiSource}/markets`],
      ['A listed market is not a promise that an executable quote is available.'],
    )
  }

  async getMarket(input: { symbol: string }) {
    const markets = await this.client.markets()
    const market = resolveMarket(markets, input.symbol)
    const [prices, risk] = await Promise.all([this.client.prices(), this.client.riskConfig()])
    const price = prices.find((candidate) => normalise(candidate.symbol) === normalise(market.symbol))
    const marketRisk = risk.symbols[market.symbol]

    return envelope(
      {
        market,
        price: price
          ? {
              usd: Number(price.price) / PRICE_SCALE,
              raw: price.price,
              scale: PRICE_SCALE,
              observedAt: new Date(price.timestamp).toISOString(),
            }
          : null,
        risk: marketRisk
          ? {
              defaultLeverage: marketRisk.defaultLeverage,
              maxLeverage: marketRisk.maxLeverage,
            }
          : null,
      },
      [
        `${this.client.apiSource}/markets`,
        `${this.client.apiSource}/prices`,
        `${this.client.apiSource}/risk-config`,
      ],
      [
        ...(price ? [] : ['No current price record was returned for this canonical symbol.']),
        ...(marketRisk ? [] : ['No risk configuration was returned for this canonical symbol.']),
        'Price is decoded from the engine 1e6 fixed-point representation.',
      ],
    )
  }

  async getFeeSchedule() {
    const risk = await this.client.riskConfig()
    const tiers = risk.feeTiers.slice().sort((a, b) => a.tierLevel - b.tierLevel)
    return envelope(
      {
        tiers,
        unit: 'basis_points',
        field: 'totalFeeRateBps',
        feeBasisStatus: 'unverified_per_side_or_round_trip',
      },
      [`${this.client.apiSource}/risk-config`],
      [
        'Values are reported exactly as supplied by the v2 engine.',
        'Whether totalFeeRateBps is per side or round trip remains unverified in this alpha.',
        'Spread is not included and must not be inferred from this schedule.',
      ],
    )
  }

  async venueStatus() {
    const [health, config, markets] = await Promise.all([
      this.client.health(),
      this.client.config(),
      this.client.markets(),
    ])
    return envelope(
      {
        service: {
          status: health.status,
          version: health.version,
          build: health.build,
          upstreamTimestamp: health.timestamp,
        },
        settlement: {
          chainId: config.chainId,
          contract: config.contractAddress ?? config.contract ?? null,
        },
        listedMarkets: markets.length,
      },
      [this.client.healthSource, `${this.client.apiSource}/config`, `${this.client.apiSource}/markets`],
      ['Listed market count does not prove quote availability or trading readiness.'],
    )
  }
}
