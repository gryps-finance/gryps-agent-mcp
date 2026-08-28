import { PRICE_SCALE, RESPONSE_SCHEMA_VERSION } from './constants.js'
import { EngineReadClient } from './client.js'
import { PublicMcpError } from './errors.js'
import { FrictionService, type FrictionSample } from './friction.js'
import {
  UNTRUSTED_SIGNAL_NOTICE,
  checkEdge,
  breakEvenEdgeBps,
  combineSignals,
  type StackedSignal,
} from './analysis.js'
import { ComparisonVenue, compareRoutes, type VenueQuote } from './router.js'
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

export interface PublicReadServiceOptions {
  comparisonUrl?: string | null
  comparisonTakerFeeBps?: number
  feeIsRoundTrip?: boolean
  spreadBpsPerSide?: number | undefined
  timeoutMs?: number
  fetcher?: typeof fetch
}

export class PublicReadService {
  private readonly friction: FrictionService
  private readonly comparison: ComparisonVenue | null

  constructor(
    private readonly client: EngineReadClient,
    private readonly options: PublicReadServiceOptions = {},
  ) {
    this.friction = new FrictionService(client, {
      ...(options.feeIsRoundTrip === undefined ? {} : { feeIsRoundTrip: options.feeIsRoundTrip }),
      ...(options.spreadBpsPerSide === undefined ? {} : { spreadBpsPerSide: options.spreadBpsPerSide }),
    })
    this.comparison = options.comparisonUrl
      ? new ComparisonVenue({
          apiUrl: options.comparisonUrl,
          takerFeeBpsPerLeg: options.comparisonTakerFeeBps ?? 0,
          timeoutMs: options.timeoutMs ?? 10_000,
          ...(options.fetcher ? { fetcher: options.fetcher } : {}),
        })
      : null
  }

  private async resolveSymbol(symbol: string): Promise<MarketRecord> {
    return resolveMarket(await this.client.markets(), symbol)
  }

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
        priceStatus: price ? 'available' : 'PRICE_UNAVAILABLE',
        risk: marketRisk
          ? { defaultLeverage: marketRisk.defaultLeverage, maxLeverage: marketRisk.maxLeverage }
          : null,
      },
      [
        `${this.client.apiSource}/markets`,
        `${this.client.apiSource}/prices`,
        `${this.client.apiSource}/risk-config`,
      ],
      [
        ...(price
          ? []
          : [
              'The engine listed this market but returned no current price record. The market is real; the price is unavailable, not zero.',
            ]),
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
        feeBasisStatus: this.options.feeIsRoundTrip ? 'confirmed_round_trip' : 'unverified_per_side_or_round_trip',
      },
      [`${this.client.apiSource}/risk-config`],
      [
        'Values are reported exactly as supplied by the v2 engine.',
        ...(this.options.feeIsRoundTrip
          ? []
          : ['Whether totalFeeRateBps is per side or round trip remains unverified.']),
        'Spread is not included and must not be inferred from this schedule.',
        'Use gryps_friction_floor for the number a trade actually has to beat.',
      ],
    )
  }

  async frictionFloor(input: { symbol: string }) {
    const market = await this.resolveSymbol(input.symbol)
    const sample = await this.friction.sample(market.symbol)
    return envelope(
      {
        symbol: market.symbol,
        roundTripBps: sample.quote.roundTripBps,
        breakEvenEdgeBps: breakEvenEdgeBps(sample.quote),
        components: {
          protocolFeeBps: sample.quote.protocolFeeBps,
          openSpreadBps: sample.quote.openSpreadBps,
          closeSpreadBps: sample.quote.closeSpreadBps,
        },
        provenance: {
          feeBasis: sample.feeBasis,
          spreadBasis: sample.spreadBasis,
          tierLevel: sample.tierLevel,
          isLowerBound: sample.isLowerBound,
          note: sample.basisNote,
        },
        measuredAt: sample.quote.measuredAtIso,
      },
      [`${this.client.apiSource}/risk-config`],
      sample.limitations,
    )
  }

  async edgeCheck(input: {
    symbol: string
    source: string
    claimedEdgeBps: number
    confidence?: number | undefined
    expectedRoundTrips?: number | undefined
    convictionMultiple?: number | undefined
  }) {
    const market = await this.resolveSymbol(input.symbol)
    const sample = await this.friction.sample(market.symbol)
    const result = checkEdge(
      { ...input, symbol: market.symbol },
      sample.quote,
      input.convictionMultiple === undefined ? {} : { convictionMultiple: input.convictionMultiple },
    )
    return envelope(
      { ...result, untrustedSignalNotice: UNTRUSTED_SIGNAL_NOTICE, frictionProvenance: sample.basisNote },
      [`${this.client.apiSource}/risk-config`],
      [
        ...sample.limitations,
        ...(sample.isLowerBound
          ? ['Friction is a lower bound, so a claim that barely clears here may not clear in reality.']
          : []),
      ],
    )
  }

  async signalStack(input: {
    signals: StackedSignal[]
    assumedCorrelation?: number | undefined
    symbol?: string | undefined
  }) {
    const result = combineSignals(
      input.signals,
      input.assumedCorrelation === undefined ? {} : { assumedCorrelation: input.assumedCorrelation },
    )

    if (!input.symbol) {
      return envelope({ ...result, untrustedSignalNotice: UNTRUSTED_SIGNAL_NOTICE, gated: null }, [], [
        'No symbol was supplied, so the combined edge was not checked against live friction.',
      ])
    }

    const market = await this.resolveSymbol(input.symbol)
    const sample = await this.friction.sample(market.symbol)
    const gate = checkEdge(
      {
        symbol: market.symbol,
        source: `stacked:${result.distinctFamilies.join('+')}`,
        claimedEdgeBps: result.effectiveEdgeBps,
      },
      sample.quote,
    )
    return envelope(
      { ...result, untrustedSignalNotice: UNTRUSTED_SIGNAL_NOTICE, gated: gate },
      [`${this.client.apiSource}/risk-config`],
      sample.limitations,
    )
  }

  async routeCompare(input: { symbol: string; side: 'long' | 'short'; notionalUsd: number }) {
    const market = await this.resolveSymbol(input.symbol)
    const sample = await this.friction.sample(market.symbol)

    const comparisonQuote: VenueQuote = this.comparison
      ? await this.comparison.quote(market.symbol, input.side, input.notionalUsd)
      : {
          venueId: 'comparison-disabled',
          allInBps: null,
          fixedCost: false,
          eligible: false,
          note: 'Venue comparison is disabled in this server configuration.',
        }

    const comparison = compareRoutes(market.symbol, input.side, input.notionalUsd, sample, comparisonQuote)
    return envelope(
      {
        ...comparison,
        comparisonTakerFeeBpsAssumed: this.options.comparisonTakerFeeBps ?? null,
      },
      [
        `${this.client.apiSource}/risk-config`,
        ...(this.options.comparisonUrl ? [this.options.comparisonUrl] : []),
      ],
      [
        ...comparison.caveats,
        'The comparison venue taker fee is an assumption supplied by configuration, not a measurement.',
      ],
    )
  }

  async indicativeQuote(input: { symbol: string; side: 'long' | 'short'; notionalUsd: number }) {
    const market = await this.resolveSymbol(input.symbol)
    const [prices, sample] = await Promise.all([this.client.prices(), this.friction.sample(market.symbol)])
    const price = prices.find((candidate) => normalise(candidate.symbol) === normalise(market.symbol))

    const engineQuoteSurface = {
      status: 'absent' as const,
      note:
        'The public Gryps engine API exposes no quote, estimate, or preview endpoint ' +
        '(surface last probed 2026-08-28). This response is derived by this server, not quoted by the venue.',
    }
    const sources = [`${this.client.apiSource}/prices`, `${this.client.apiSource}/risk-config`]

    if (!price) {
      return envelope(
        {
          symbol: market.symbol,
          side: input.side,
          notionalUsd: input.notionalUsd,
          quoteStatus: 'PRICE_UNAVAILABLE' as const,
          firm: false,
          quoteBasis: 'derived_from_oracle_price_and_friction_model' as const,
          engineQuoteSurface,
          oracleMid: null,
          estimate: null,
          provenance: {
            feeBasis: sample.feeBasis,
            spreadBasis: sample.spreadBasis,
            tierLevel: sample.tierLevel,
            isLowerBound: sample.isLowerBound,
            note: sample.basisNote,
          },
        },
        sources,
        [
          'The engine listed this market but returned no current price record, so no indicative estimate can be derived.',
        ],
      )
    }

    const midUsd = Number(price.price) / PRICE_SCALE
    const perSideFeeBps = sample.quote.protocolFeeBps / 2
    const openLegBps = perSideFeeBps + sample.quote.openSpreadBps
    const sideSign = input.side === 'long' ? 1 : -1
    const estimatedEntryPriceUsd = midUsd * (1 + (sideSign * sample.quote.openSpreadBps) / 10_000)

    return envelope(
      {
        symbol: market.symbol,
        side: input.side,
        notionalUsd: input.notionalUsd,
        quoteStatus: 'derived' as const,
        firm: false,
        quoteBasis: 'derived_from_oracle_price_and_friction_model' as const,
        engineQuoteSurface,
        oracleMid: {
          usd: midUsd,
          raw: price.price,
          scale: PRICE_SCALE,
          observedAt: new Date(price.timestamp).toISOString(),
        },
        estimate: {
          estimatedEntryPriceUsd,
          baseQuantity: input.notionalUsd / midUsd,
          quantityPrecision: market.quantityPrecision,
          openLegBps,
          roundTripBps: sample.quote.roundTripBps,
          breakEvenEdgeBps: breakEvenEdgeBps(sample.quote),
          openCostUsd: (input.notionalUsd * openLegBps) / 10_000,
          roundTripCostUsd: (input.notionalUsd * sample.quote.roundTripBps) / 10_000,
        },
        provenance: {
          feeBasis: sample.feeBasis,
          spreadBasis: sample.spreadBasis,
          tierLevel: sample.tierLevel,
          isLowerBound: sample.isLowerBound,
          note: sample.basisNote,
        },
      },
      sources,
      [
        ...sample.limitations,
        'This is a cost model, not a tradable quote. Executable price and size are unknown until the engine exposes a quote surface.',
        'Base quantity is unrounded; the engine may enforce the stated quantity precision.',
        ...(sample.isLowerBound
          ? ['Spread is unmeasured, so the estimated entry price equals the oracle mid and understates real entry cost.']
          : []),
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
        catalogue: {
          engineReportedMarketCount: markets.length,
          reconciledWithDocumentation: false,
          publishableAsClaim: false,
        },
      },
      [this.client.healthSource, `${this.client.apiSource}/config`, `${this.client.apiSource}/markets`],
      [
        'The engine-reported market count has not been reconciled with published Gryps documentation and must not be repeated as a public claim.',
        'A listed market count does not prove quote availability or trading readiness.',
      ],
    )
  }
}
