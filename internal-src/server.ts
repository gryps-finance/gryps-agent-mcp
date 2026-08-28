import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { AccountReadClient, ObserverUpstreamError } from './client.js'
import type { ObserverConfig } from './config.js'

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

function envelope(data: unknown, accountAddress: string) {
  return {
    schemaVersion: '1.0',
    status: 'ok',
    data,
    meta: {
      profile: 'internal_observer',
      accountAddress,
      fetchedAt: new Date().toISOString(),
      readOnly: true,
      limitations: [
        'This profile reads engine state for one operator-configured address.',
        'A successful read does not grant signing or trading authority.',
      ],
    },
  }
}

function errorEnvelope(error: unknown) {
  const upstream = error instanceof ObserverUpstreamError
  return {
    schemaVersion: '1.0',
    status: 'error',
    error: {
      code: upstream ? error.code : 'internal_error',
      message: upstream ? error.message : 'The account read could not be completed.',
    },
    meta: { profile: 'internal_observer', fetchedAt: new Date().toISOString(), readOnly: true },
  }
}

function result(payload: object, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
    ...(isError ? { isError: true } : {}),
  }
}

async function safely(operation: () => Promise<object>) {
  try {
    return result(await operation())
  } catch (error) {
    return result(errorEnvelope(error), true)
  }
}

export const INTERNAL_OBSERVER_TOOLS = [
  'gryps_account_snapshot',
  'gryps_account_portfolio',
  'gryps_account_order_history',
  'gryps_account_trades',
] as const

export function createObserverServer(config: ObserverConfig, fetcher?: typeof fetch): McpServer {
  const client = new AccountReadClient(config, fetcher)
  const server = new McpServer({ name: 'gryps-agent-mcp-internal-observer', version: '0.1.0' })

  server.registerTool(
    INTERNAL_OBSERVER_TOOLS[0],
    {
      title: 'Read the configured Gryps account snapshot',
      description: 'Read balances, margin, positions, pending orders, and pending withdrawals for the single address fixed at process start.',
      inputSchema: {},
      annotations,
    },
    () => safely(async () => envelope(await client.snapshot(), config.accountAddress)),
  )
  server.registerTool(
    INTERNAL_OBSERVER_TOOLS[1],
    {
      title: 'Read the configured Gryps portfolio',
      description: 'Read the aggregate portfolio and PnL view for the single address fixed at process start.',
      inputSchema: {},
      annotations,
    },
    () => safely(async () => envelope(await client.portfolio(), config.accountAddress)),
  )
  const pageInput = {
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).max(100_000).default(0),
  }
  server.registerTool(
    INTERNAL_OBSERVER_TOOLS[2],
    {
      title: 'Read the configured Gryps account order history',
      description: 'Read a bounded page of order history for the single address fixed at process start.',
      inputSchema: pageInput,
      annotations,
    },
    ({ limit, offset }) => safely(async () => envelope(await client.orders(limit, offset), config.accountAddress)),
  )
  server.registerTool(
    INTERNAL_OBSERVER_TOOLS[3],
    {
      title: 'Read the configured Gryps account trades',
      description: 'Read a bounded page of fills/trades for the single address fixed at process start.',
      inputSchema: pageInput,
      annotations,
    },
    ({ limit, offset }) => safely(async () => envelope(await client.trades(limit, offset), config.accountAddress)),
  )
  return server
}
