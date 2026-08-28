import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { EngineReadClient } from './client.js'
import type { PublicMcpConfig } from './config.js'
import { PUBLIC_TOOL_NAMES, SERVER_NAME, PACKAGE_VERSION } from './constants.js'
import { errorEnvelope } from './errors.js'
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
  const service = new PublicReadService(new EngineReadClient({ config, ...options }))
  const server = new McpServer({ name: SERVER_NAME, version: PACKAGE_VERSION })

  server.registerTool(
    PUBLIC_TOOL_NAMES[0],
    {
      title: 'List Gryps v2 markets',
      description:
        'Browse the live Gryps v2 market catalogue. Supports bounded search and pagination. Read-only. A listed market is not a promise of quote availability.',
      inputSchema: {
        query: z.string().trim().min(1).max(100).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).max(10_000).default(0),
      },
      annotations,
    },
    ({ query, limit, offset }) => safely(() => service.listMarkets({ ...(query ? { query } : {}), limit, offset })),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[1],
    {
      title: 'Get one Gryps v2 market',
      description:
        'Resolve one exact canonical symbol, display name, or unique base asset. Returns live price and leverage limits without substring guessing. Read-only.',
      inputSchema: {
        symbol: z.string().trim().min(1).max(40),
      },
      annotations,
    },
    ({ symbol }) => safely(() => service.getMarket({ symbol })),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[2],
    {
      title: 'Get the Gryps v2 fee schedule',
      description:
        'Read the live engine-reported fee tiers. The response explicitly states that per-side versus round-trip fee basis remains unverified. Read-only.',
      inputSchema: {},
      annotations,
    },
    () => safely(() => service.getFeeSchedule()),
  )

  server.registerTool(
    PUBLIC_TOOL_NAMES[3],
    {
      title: 'Check Gryps v2 venue status',
      description:
        'Check live API health, build version, settlement chain and contract, and listed market count. Read-only and non-account-specific.',
      inputSchema: {},
      annotations,
    },
    () => safely(() => service.venueStatus()),
  )

  return server
}
