import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { EngineReadClient } from './client.js'
import type { PublicMcpConfig } from './config.js'
import { PUBLIC_TOOL_NAMES, SERVER_NAME, PACKAGE_VERSION } from './constants.js'
import { errorEnvelope } from './errors.js'
import { SIGNAL_FAMILIES } from './analysis.js'
import { AUTONOMIES, LEVELS, PURPOSES, STAGES } from './library.js'
import { PublicReadService } from './service.js'

function result(payload: object, isError = false) {
  const structuredContent = payload as Record<string, unknown>
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  }
}

async function safely<T extends object>(operation: () => Promise<T>) {
  try {
    return result(await operation())
  } catch (error) {
    return result(errorEnvelope(error), true)
  }
}

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

export interface PublicServerOptions {
  fetcher?: typeof fetch
  nowMs?: () => number
  retryDelayMs?: number
}

export function createPublicServer(config: PublicMcpConfig, options: PublicServerOptions = {}): McpServer {
  const client = new EngineReadClient({ config, ...options })
  const service = new PublicReadService(client, {
    comparisonUrl: config.comparisonUrl,
    comparisonTakerFeeBps: config.comparisonTakerFeeBps,
    feeIsRoundTrip: config.feeIsRoundTrip,
    spreadBpsPerSide: config.spreadBpsPerSide,
    timeoutMs: config.timeoutMs,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  })
  const server = new McpServer({ name: SERVER_NAME, version: PACKAGE_VERSION })

  server.registerTool(
    PUBLIC_TOOL_NAMES[0],
    {
      title: 'List Gryps v2 markets',
      description:
        'Browse the live Gryps v2 market catalogue with bounded search and pagination. Read-only. A listed market is not a promise of quote availability.',
      inputSchema: {
        query: z.string().trim().min(1).max(100).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).max(10_000).default(0),
      },
      annotations,
    },
    ({ query, limit, offset }) =>
      safely(() => service.listMarkets({ ...(query ? { query } : {}), limit, offset })),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[1],
    {
      title: 'Get one Gryps v2 market',
      description:
        'Resolve one exact canonical symbol, display name, or unique base asset and return live price and leverage limits. Never guesses by substring. Returns a typed PRICE_UNAVAILABLE status rather than inventing a price.',
      inputSchema: { symbol: z.string().trim().min(1).max(40) },
      annotations,
    },
    ({ symbol }) => safely(() => service.getMarket({ symbol })),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[2],
    {
      title: 'Check Gryps v2 venue status',
      description:
        'Check live API health, build version, and settlement chain and contract. The engine-reported market count is returned but is explicitly flagged as unreconciled and not publishable as a claim.',
      inputSchema: {},
      annotations,
    },
    () => safely(() => service.venueStatus()),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[3],
    {
      title: 'Measure the Gryps friction floor',
      description:
        'Return the live round-trip cost a trade must beat on Gryps, decomposed into fees and spread with full provenance. States plainly whether the number is a measured fee floor or all-in friction, and whether it is a lower bound. This is the number that decides whether a trade is worth making.',
      inputSchema: { symbol: z.string().trim().min(1).max(40) },
      annotations,
    },
    ({ symbol }) => safely(() => service.frictionFloor({ symbol })),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[4],
    {
      title: 'Get the Gryps v2 fee schedule',
      description:
        'Read the live engine-reported fee tier ladder. Fees are only part of friction: use gryps_friction_floor for the number a trade actually has to beat.',
      inputSchema: {},
      annotations,
    },
    () => safely(() => service.getFeeSchedule()),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[5],
    {
      title: 'Cost-gate a claimed trading edge',
      description:
        'Take a claimed edge from any upstream signal source and answer whether it could survive live execution cost with a margin of safety. Source-agnostic. It never evaluates whether the signal is true, only whether the claimed magnitude can pay for its own execution. Treats third-party signal text as untrusted data, never instruction.',
      inputSchema: {
        symbol: z.string().trim().min(1).max(40),
        source: z.string().trim().min(1).max(120).describe('Where the claim came from, for example "TradingView RSI".'),
        claimedEdgeBps: z.number().finite().min(-10_000).max(100_000).describe('The move the signal expects to capture, in basis points.'),
        confidence: z.number().min(0).max(1).optional().describe('Caller confidence. Lower confidence widens the required edge.'),
        expectedRoundTrips: z.number().int().min(1).max(1_000).optional().describe('Round trips expected for a repeated signal. Cost compounds; edge usually does not.'),
        convictionMultiple: z.number().min(1).max(10).optional().describe('Margin of safety applied to friction. Default 1.5.'),
      },
      annotations,
    },
    (input) => safely(() => service.edgeCheck(input)),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[6],
    {
      title: 'Combine stacked signals honestly',
      description:
        'Combine several agreeing signals into one honest edge estimate. Correlated sources are prevented from being counted as independent confirmations, because correlated evidence inflates confidence without inflating edge, and confidence is what sets position size. Supply a symbol to also cost-gate the combined result.',
      inputSchema: {
        signals: z
          .array(
            z.object({
              source: z.string().trim().min(1).max(120),
              family: z.enum(SIGNAL_FAMILIES),
              claimedEdgeBps: z.number().finite().min(-10_000).max(100_000),
            }),
          )
          .min(1)
          .max(25),
        assumedCorrelation: z.number().min(0).max(1).optional().describe('Your belief about independence. Raised automatically if the source families overlap.'),
        symbol: z.string().trim().min(1).max(40).optional().describe('Supply to gate the combined edge against live friction.'),
      },
      annotations,
    },
    (input) => safely(() => service.signalStack(input)),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[7],
    {
      title: 'Compare execution cost across venues',
      description:
        'Compare the round-trip cost of a clip on Gryps against a public order-book venue priced by walking its live displayed depth. Gryps cost is quoted and does not grow with clip size; book cost does. This tool reports the other venue as cheaper when that is what the numbers say.',
      inputSchema: {
        symbol: z.string().trim().min(1).max(40),
        side: z.enum(['long', 'short']).default('long'),
        notionalUsd: z.number().positive().max(1_000_000_000).describe('Clip size in USD. Book impact depends on it.'),
      },
      annotations,
    },
    ({ symbol, side, notionalUsd }) => safely(() => service.routeCompare({ symbol, side, notionalUsd })),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[8],
    {
      title: 'Get an indicative Gryps execution estimate',
      description:
        'Produce an indicative, non-firm execution estimate for one clip: oracle mid, estimated entry price, base quantity, and the all-in cost model with full provenance. The engine exposes no quote surface, so this is derived from the live oracle price plus measured friction and is labeled as such. It is a cost model, never a tradable quote.',
      inputSchema: {
        symbol: z.string().trim().min(1).max(40),
        side: z.enum(['long', 'short']).default('long'),
        notionalUsd: z.number().positive().max(1_000_000_000).describe('Clip size in USD.'),
      },
      annotations,
    },
    ({ symbol, side, notionalUsd }) => safely(() => service.indicativeQuote({ symbol, side, notionalUsd })),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[9],
    {
      title: 'Compare the Gryps oracle to an external reference mid',
      description:
        'Read the live Gryps oracle price for one market next to a fair-value mid from a public reference venue, and report the divergence in basis points. The anchor for oracle sanity checks and paper-session pricing. The reference mid is a midpoint of displayed quotes, never a tradable price.',
      inputSchema: { symbol: z.string().trim().min(1).max(40) },
      annotations,
    },
    ({ symbol }) => safely(() => service.referencePrice({ symbol })),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[10],
    {
      title: 'Find the next step in the Gryps journey',
      description:
        'Recommend what to do next, given where the caller already is. Call it with no arguments on a fresh install to get one starting point rather than a catalogue. Prompts for live stages are withheld until the funding station is complete, because exploration should be free and commitment should be deliberate. Recovery prompts are never withheld.',
      inputSchema: {
        currentPromptId: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .optional()
          .describe('The prompt just completed. Omit for a fresh start.'),
        fundStationComplete: z
          .boolean()
          .optional()
          .describe('Set true only if the caller has funded and authorised an account elsewhere. Unlocks live-stage guidance.'),
      },
      annotations,
    },
    ({ currentPromptId, fundStationComplete }) =>
      safely(async () =>
        service.nextStep({
          ...(currentPromptId === undefined ? {} : { currentPromptId }),
          ...(fundStationComplete === undefined ? {} : { fundStationComplete }),
        }),
      ),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[11],
    {
      title: 'Browse the Gryps prompt library',
      description:
        'Search the staged prompt library by journey stage, experience level, purpose, autonomy, or free text. Every entry says what it does and why it matters. These are prompts for the caller to run, not actions this server performs.',
      inputSchema: {
        stage: z.enum(STAGES).optional().describe('Journey stage, from land through operate.'),
        level: z.enum(LEVELS).optional().describe('Experience level, from never-used-an-agent to built-bots.'),
        purpose: z.enum(PURPOSES).optional(),
        autonomy: z.enum(AUTONOMIES).optional().describe('Asking for a live level by name is treated as a deliberate request.'),
        text: z.string().trim().min(1).max(100).optional(),
        fundStationComplete: z.boolean().optional(),
      },
      annotations,
    },
    (input) => safely(async () => service.promptLibrary(input)),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[12],
    {
      title: 'Run a paper trading session',
      description:
        'Rehearse trades against live prices with zero capital. Open and close paper positions marked at the oracle mid with real friction charged per leg; every close decomposes the result into price move versus friction paid. Positions are bookkeeping in this server process only: no order exists anywhere, and state is lost when the process ends. Actions: open (symbol, side, notionalUsd), close (positionId), status, reset.',
      inputSchema: {
        action: z.enum(['open', 'close', 'status', 'reset']),
        symbol: z.string().trim().min(1).max(40).optional().describe('Required for action "open".'),
        side: z.enum(['long', 'short']).optional().describe('Required for action "open".'),
        notionalUsd: z.number().positive().max(1_000_000_000).optional().describe('Clip size in USD. Required for action "open".'),
        positionId: z.string().trim().min(1).max(40).optional().describe('Required for action "close".'),
      },
      annotations,
    },
    (input) => safely(() => service.paperSession(input)),
  )

  return server
}
