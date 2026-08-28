import { CANONICAL_SETTLEMENT, PRICE_SCALE, RESPONSE_SCHEMA_VERSION } from './constants.js'
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
import { nextStep, queryLibrary, type LibraryFilter } from './library.js'
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

/**
 * The provenance block every friction-derived tool carries. It states not just
 * what was measured but which questions are still open, because a caller that
 * cannot see the open questions will treat a floor as a fact.
 */
type SettlementStatus = 'verified' | 'mismatch' | 'unreported'

export interface SettlementCheck {
  chainId: number | string
  contract: string | null
  collateralToken: string | null
  status: SettlementStatus
  canonical: typeof CANONICAL_SETTLEMENT
  mismatches: string[]
}

/**
 * Compare the engine's self-reported settlement identity against the values
 * pinned in this package. Relaying what an endpoint says about itself proves
 * nothing: a wrong or hostile endpoint answers with the same confidence as the
 * right one. This server states which of the two it is talking to.
 */
export function settlementCheck(config: {
  chainId: number | string
  contractAddress?: string | undefined
  contract?: string | undefined
  usdcAddress?: string | undefined
}): SettlementCheck {
  const contract = config.contractAddress ?? config.contract ?? null
  const collateralToken = config.usdcAddress ?? null
  const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase()

  const mismatches: string[] = []
  if (String(config.chainId) !== String(CANONICAL_SETTLEMENT.chainId)) {
    mismatches.push(
      `Chain id ${config.chainId} does not match the canonical ${CANONICAL_SETTLEMENT.chainId} (${CANONICAL_SETTLEMENT.chainName}).`,
    )
  }
  if (contract !== null && !same(contract, CANONICAL_SETTLEMENT.contract)) {
    mismatches.push(`Settlement contract ${contract} does not match the canonical ${CANONICAL_SETTLEMENT.contract}.`)
  }
  if (collateralToken !== null && !same(collateralToken, CANONICAL_SETTLEMENT.collateralToken)) {
    mismatches.push(
      `Collateral token ${collateralToken} does not match the canonical ${CANONICAL_SETTLEMENT.collateralToken}.`,
    )
  }

  const status: SettlementStatus =
    mismatches.length > 0 ? 'mismatch' : contract === null ? 'unreported' : 'verified'

  return { chainId: config.chainId, contract, collateralToken, status, canonical: CANONICAL_SETTLEMENT, mismatches }
}

function provenanceOf(sample: FrictionSample) {
  return {
    feeBasis: sample.feeBasis,
    spreadBasis: sample.spreadBasis,
    tierLevel: sample.tierLevel,
    isLowerBound: sample.isLowerBound,
    feeDirection: sample.feeDirection,
    spreadSurface: sample.spreadSurface,
    note: sample.basisNote,
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
  feeIsRoundTrip?: boolean | undefined
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
        feeBasisStatus:
          this.options.feeIsRoundTrip === undefined
            ? ('unverified_per_side_or_round_trip' as const)
            : this.options.feeIsRoundTrip
              ? ('declared_round_trip' as const)
              : ('declared_per_side' as const),
        feeBasisResolved: this.options.feeIsRoundTrip !== undefined,
      },
      [`${this.client.apiSource}/risk-config`],
      [
        'Values are reported exactly as supplied by the v2 engine.',
        ...(this.options.feeIsRoundTrip === undefined
          ? [
              'Whether totalFeeRateBps is per side or round trip remains unverified. The engine does not say, and the answer doubles or halves every cost figure derived from this ladder.',
            ]
          : ['Fee direction was declared by operator configuration, not by the engine.']),
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
        // The headline pair above assumes a fee direction the engine never
        // states. Both readings travel with it so the assumption cannot be
        // inherited silently by anything that sizes a position from this.
        feeDirectionRange: {
          resolved: sample.feeDirection.resolved,
          roundTripBpsIfPerSide: sample.feeDirection.roundTripBpsIfPerSide,
          roundTripBpsIfRoundTrip: sample.feeDirection.roundTripBpsIfRoundTrip,
          breakEvenEdgeBpsIfPerSide: breakEvenEdgeBps({
            ...sample.quote,
            roundTripBps: sample.feeDirection.roundTripBpsIfPerSide,
          }),
          breakEvenEdgeBpsIfRoundTrip: breakEvenEdgeBps({
            ...sample.quote,
            roundTripBps: sample.feeDirection.roundTripBpsIfRoundTrip,
          }),
          note: sample.feeDirection.note,
        },
        components: {
          protocolFeeBps: sample.quote.protocolFeeBps,
          openSpreadBps: sample.quote.openSpreadBps,
          closeSpreadBps: sample.quote.closeSpreadBps,
        },
        provenance: provenanceOf(sample),
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
    // A verdict that flips depending on an unresolved question is not a
    // verdict. Re-run the gate against the other reading of the fee rate and
    // say plainly whether the answer holds either way.
    const alternateRoundTripBps =
      sample.feeDirection.assumed === 'per-side'
        ? sample.feeDirection.roundTripBpsIfRoundTrip
        : sample.feeDirection.roundTripBpsIfPerSide
    const alternate = checkEdge(
      { ...input, symbol: market.symbol },
      { ...sample.quote, roundTripBps: alternateRoundTripBps },
      input.convictionMultiple === undefined ? {} : { convictionMultiple: input.convictionMultiple },
    )
    const feeDirectionSensitivity = sample.feeDirection.resolved
      ? null
      : {
          assumedReading: sample.feeDirection.assumed,
          alternateReading: sample.feeDirection.assumed === 'per-side' ? 'round-trip' : 'per-side',
          alternateRoundTripBps,
          alternateRequiredEdgeBps: alternate.requiredEdgeBps,
          alternateClears: alternate.clears,
          verdictStable: alternate.clears === result.clears,
        }

    return envelope(
      {
        ...result,
        untrustedSignalNotice: UNTRUSTED_SIGNAL_NOTICE,
        frictionProvenance: sample.basisNote,
        feeDirectionSensitivity,
      },
      [`${this.client.apiSource}/risk-config`],
      [
        ...sample.limitations,
        ...(sample.isLowerBound
          ? ['Friction is a lower bound, so a claim that barely clears here may not clear in reality.']
          : []),
        ...(feeDirectionSensitivity && !feeDirectionSensitivity.verdictStable
          ? [
              'This verdict FLIPS under the other reading of the engine fee rate. The fee direction is unresolved, so this call is not decidable from live data alone. Treat it as a hold until the basis is confirmed.',
            ]
          : []),
        ...(feeDirectionSensitivity?.verdictStable
          ? ['The verdict holds under both readings of the unresolved fee direction.']
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
          provenance: provenanceOf(sample),
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
        provenance: provenanceOf(sample),
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

  async referencePrice(input: { symbol: string }) {
    const market = await this.resolveSymbol(input.symbol)
    const prices = await this.client.prices()
    const price = prices.find((candidate) => normalise(candidate.symbol) === normalise(market.symbol))
    const oracle = price
      ? {
          usd: Number(price.price) / PRICE_SCALE,
          raw: price.price,
          scale: PRICE_SCALE,
          observedAt: new Date(price.timestamp).toISOString(),
        }
      : null

    const baseLimitations = [
      'The reference coin is derived by stripping the quote suffix, so contract specification and margining may differ between venues.',
      'The reference mid is the midpoint of displayed top-of-book on the reference venue, not a tradable price.',
      "The displayed spread is the reference venue's own book spread. It says nothing about Gryps spread.",
      'Oracle and reference observations are not simultaneous, so divergence includes any timing skew.',
      ...(oracle ? [] : ['The engine listed this market but returned no current price record, so divergence cannot be computed.']),
    ]

    if (!this.comparison) {
      return envelope(
        {
          symbol: market.symbol,
          oracle,
          oracleStatus: oracle ? ('available' as const) : ('PRICE_UNAVAILABLE' as const),
          reference: null,
          referenceStatus: 'comparison_disabled' as const,
          divergenceBps: null,
        },
        [`${this.client.apiSource}/prices`],
        [
          'Venue comparison is disabled in this server configuration, so no external reference mid is available.',
          ...baseLimitations,
        ],
      )
    }

    let reference: Awaited<ReturnType<ComparisonVenue['referenceMid']>> = null
    let referenceStatus: 'available' | 'not_listed' | 'reference_unavailable'
    try {
      reference = await this.comparison.referenceMid(market.symbol)
      referenceStatus = reference ? 'available' : 'not_listed'
    } catch {
      referenceStatus = 'reference_unavailable'
    }

    const divergenceBps =
      oracle && reference ? ((oracle.usd - reference.mid) / reference.mid) * 10_000 : null

    return envelope(
      {
        symbol: market.symbol,
        oracle,
        oracleStatus: oracle ? ('available' as const) : ('PRICE_UNAVAILABLE' as const),
        reference,
        referenceStatus,
        divergenceBps,
      },
      [
        `${this.client.apiSource}/prices`,
        ...(this.options.comparisonUrl ? [this.options.comparisonUrl] : []),
      ],
      [
        ...baseLimitations,
        ...(referenceStatus === 'not_listed'
          ? ['This market is not listed on the reference venue, so no external mid exists for it.']
          : []),
        ...(referenceStatus === 'reference_unavailable'
          ? ['The reference venue was unreachable. Only the Gryps oracle side of this read is available.']
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
    const settlement = settlementCheck(config)
    return envelope(
      {
        service: {
          status: health.status,
          version: health.version,
          build: health.build,
          upstreamTimestamp: health.timestamp,
        },
        settlement,
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
        ...(settlement.status === 'verified'
          ? []
          : [
              `SETTLEMENT IDENTITY ${settlement.status.toUpperCase()}. The endpoint this server is pointed at does not report the canonical Gryps settlement identity: ${settlement.mismatches.join(' ')} Do not treat any figure from this server as describing canonical Gryps until the endpoint is corrected.`,
            ]),
        'Settlement identity is compared against values pinned in this package, not taken on the endpoint word.',
      ],
    )
  }

  /**
   * Journey routing. No network access: the library is embedded, so onboarding
   * still works when the venue is unreachable, which is exactly when a confused
   * new user is most likely to be asking what to do.
   */
  async nextStep(input: { currentPromptId?: string | undefined; fundStationComplete?: boolean | undefined } = {}) {
    return envelope(nextStep(input), ['embedded prompt library'], [
      'These are prompts for you to run. This server performs none of them.',
      'Live-stage guidance describes a journey that continues outside this package, which cannot trade, sign, or hold assets.',
    ])
  }

  async promptLibrary(input: LibraryFilter = {}) {
    return envelope(queryLibrary(input), ['embedded prompt library'], [
      'These are prompts for you to run. This server performs none of them.',
      'Prompts above the money line are withheld until the funding station is complete, or until requested deliberately by autonomy level.',
    ])
  }
}
