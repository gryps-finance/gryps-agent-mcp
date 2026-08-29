import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { EngineReadClient } from './client.js'
import type { PublicMcpConfig } from './config.js'
import { PUBLIC_TOOL_NAMES, SERVER_NAME, PACKAGE_VERSION } from './constants.js'
import { errorEnvelope } from './errors.js'
import { SIGNAL_FAMILIES } from './analysis.js'
import { AUTONOMIES, LEVELS, PURPOSES, STAGES } from './library.js'
import { JOURNEY_PROMPTS } from './journey.js'
import { SERVER_INSTRUCTIONS, capabilityReport } from './orientation.js'
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
    explorerUrl: config.explorerUrl,
    timeoutMs: config.timeoutMs,
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
  })
  const server = new McpServer(
    { name: SERVER_NAME, version: PACKAGE_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  )

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
        'Combine several agreeing signals into one honest edge estimate. Repeats of one source are folded together, near-identical source names are treated as one feed, and correlated families are prevented from being counted as independent confirmations, because correlated evidence inflates confidence without inflating edge, and confidence is what sets position size. Supply a symbol to also cost-gate the combined result.',
      inputSchema: {
        signals: z
          .array(
            z.object({
              source: z.string().trim().min(1).max(120),
              family: z.enum(SIGNAL_FAMILIES),
              claimedEdgeBps: z.number().finite().min(-10_000).max(100_000),
              originId: z
                .string()
                .trim()
                .min(1)
                .max(120)
                .optional()
                .describe(
                  'Identifier of the upstream this signal came from. Two signals sharing one are folded together, however different their source labels look.',
                ),
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

  server.registerTool(
    'gryps_capabilities',
    {
      title: 'Describe what this server is and is not',
      description:
        'One call that explains the server: what it answers, what it refuses, which live sources it reads, and every known limitation with its consequence. Call this before reasoning about what the other tools can do, rather than inferring it from their descriptions.',
      inputSchema: {},
      annotations,
    },
    async () => result(capabilityReport(SERVER_NAME, PACKAGE_VERSION)),
  )

  // Native MCP prompts. Clients surface these in their own interface, so the
  // guided journey is visible to someone who does not know to ask for it.
  for (const prompt of JOURNEY_PROMPTS) {
    server.registerPrompt(
      prompt.id,
      { title: prompt.title, description: prompt.summary },
      () => ({
        messages: [{ role: 'user' as const, content: { type: 'text' as const, text: prompt.body } }],
      }),
    )
  }

  server.registerTool(
    'gryps_measured_fees',
    {
      title: 'Measure fees actually paid, from the chain',
      description:
        'Read the settlement contract event log from a public block explorer and report the median fee real fills actually paid, rather than what the fee schedule advertises. Because the measurement is one-way by construction, it is also direct evidence on whether the advertised rate covers one side or a round trip. Keyless and read-only.',
      inputSchema: {
        symbol: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .optional()
          .describe('Narrow to one market. Falls back to a venue-wide median when that market has too few recent fills.'),
        maxPages: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Explorer pages to scan. More pages mean a larger sample and a slower call.'),
      },
      annotations,
    },
    (input) => safely(() => service.measuredFees(input)),
  )

  server.registerTool(
    'gryps_margin_profile',
    {
      title: 'Find where the position gets liquidated',
      description:
        'Turn the venue published maintenance-margin ladder into the numbers a trade actually needs: which bracket a given size falls into, the initial and maintenance margin it requires, the maximum leverage available at that size, and how far the price can move against the position before it is liquidated, in basis points and in dollars. Supply a claimed edge to also check whether the position can survive long enough for that move to arrive. Arithmetic on published parameters, not a promise from the liquidation engine.',
      inputSchema: {
        symbol: z.string().trim().min(1).max(40),
        notionalUsd: z
          .number()
          .positive()
          .max(1_000_000_000)
          .describe('Position size in USD. Bracket, maintenance rate, and leverage ceiling all depend on it.'),
        side: z.enum(['long', 'short']).default('long'),
        leverage: z
          .number()
          .positive()
          .max(200)
          .optional()
          .describe('Leverage to price. Defaults to the market default, and is clamped to the ceiling for this size.'),
        claimedEdgeBps: z
          .number()
          .finite()
          .min(-10_000)
          .max(100_000)
          .optional()
          .describe('The move being waited for. Supply it to check the position survives long enough to see it.'),
      },
      annotations,
    },
    ({ symbol, notionalUsd, side, leverage, claimedEdgeBps }) =>
      safely(() =>
        service.marginProfile({
          symbol,
          notionalUsd,
          side,
          ...(leverage === undefined ? {} : { leverage }),
          ...(claimedEdgeBps === undefined ? {} : { claimedEdgeBps }),
        }),
      ),
  )

  server.registerTool(
    'gryps_position_size',
    {
      title: 'Size a position against cost, margin, and liquidation',
      description:
        'Answer how large a position can be, given what the trade costs, how much of the account the caller will commit, the venue margin brackets, and whether the position survives long enough for the expected move to arrive. Returns the largest size satisfying every constraint and names the one that binds. A calculator over supplied constraints, not a recommendation, and it sizes a claim without checking whether the claim is true.',
      inputSchema: {
        symbol: z.string().trim().min(1).max(40),
        claimedEdgeBps: z
          .number()
          .finite()
          .min(-10_000)
          .max(100_000)
          .describe('The move being waited for, in basis points.'),
        accountEquityUsd: z.number().positive().max(1_000_000_000).describe('Total account equity in USD.'),
        riskBudgetPct: z
          .number()
          .positive()
          .max(100)
          .optional()
          .describe('Share of equity to commit as margin. Default 1 percent.'),
        safetyMultiple: z
          .number()
          .min(0)
          .max(20)
          .optional()
          .describe(
            'How many times the claimed edge the position must absorb against it before liquidation. Default 2.',
          ),
      },
      annotations,
    },
    ({ symbol, claimedEdgeBps, accountEquityUsd, riskBudgetPct, safetyMultiple }) =>
      safely(() =>
        service.positionSize({
          symbol,
          claimedEdgeBps,
          accountEquityUsd,
          ...(riskBudgetPct === undefined ? {} : { riskBudgetPct }),
          ...(safetyMultiple === undefined ? {} : { safetyMultiple }),
        }),
      ),
  )

  server.registerTool(
    'gryps_funding_cost',
    {
      title: 'Price the cost of holding, not just entering',
      description:
        'Report the live funding rate for one market and what it costs to hold a position across a given duration, alongside round-trip friction, so a trade can be gated on its all-in cost rather than its entry cost. Funding is a transfer between traders, so one side pays what the other receives. The engine publishes the rate but not the interval it is charged over, so the candidate intervals are derived from the advertised funding stamp — an interval survives only if the stamp sits on its grid and the previous stamp has already passed — and the hold cost is reported across whatever survives. Intervals differ between markets on this venue, so one confirmed for one market must not be assumed for another.',
      inputSchema: {
        symbol: z.string().trim().min(1).max(40),
        side: z.enum(['long', 'short']).default('long'),
        notionalUsd: z.number().positive().max(1_000_000_000).describe('Position size in USD.'),
        holdHours: z
          .number()
          .min(0)
          .max(8_760)
          .describe('How long the position is expected to be held, in hours.'),
        intervalHours: z
          .number()
          .positive()
          .max(24)
          .optional()
          .describe('Funding interval, once the venue confirms it. Left unset, every plausible interval is reported.'),
      },
      annotations,
    },
    ({ symbol, side, notionalUsd, holdHours, intervalHours }) =>
      safely(() =>
        service.fundingCost({
          symbol,
          side,
          notionalUsd,
          holdHours,
          ...(intervalHours === undefined ? {} : { intervalHours }),
        }),
      ),
  )

  return server
}
