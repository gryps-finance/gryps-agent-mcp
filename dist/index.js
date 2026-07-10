#!/usr/bin/env node
/**
 * @gryps/agent-mcp — read-mode MCP server for Gryps venue state.
 *
 * Tier 2 of the Gryps Agentic churn-proof build plan:
 * - READ-ONLY. No order placement, no signing, no writes. (Write mode ships
 *   later behind the same adapter seam, gated on the venue's rollout plan.)
 * - All venue knowledge lives in src/adapters/. This file knows only the
 *   VenueAdapter contract.
 * - Fees/leverage/symbols are served as live data, never constants.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { GrypsOrbsAdapter } from './adapters/gryps-orbs.js';
import { PolygonRollupAdapter } from './adapters/polygon-rollup.js';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Explicit configuration (ADR-009): defaults are visible here, overridable
// via CLI flags — never silently read from the environment.
const args = new Map(process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=')];
}));
const adapter = new GrypsOrbsAdapter({
    solverBaseUrl: args.get('solver-base') ??
        'https://www.perps-streaming.com/v1/1329a/0x78B1b8134A4236e69aE3728691e90B31f02C3001',
    appApiBaseUrl: args.get('app-api-base') ?? 'https://app.gryps.finance/api',
});
const server = new McpServer({
    name: 'gryps-agent-mcp',
    version: '0.1.0',
});
server.tool('gryps_list_markets', 'List live Gryps markets. Supports filtering by category (e.g. "Commodities", "Stocks", "RWA") or RFQ availability. Fees and leverage are live venue data.', {
    category: z.string().optional().describe('Filter by category tag'),
    rfqOnly: z.boolean().optional().describe('Only RFQ-enabled markets'),
    limit: z.number().int().positive().max(1000).optional(),
}, async ({ category, rfqOnly, limit }) => {
    let markets = await adapter.listMarkets();
    if (category) {
        const c = category.toLowerCase();
        markets = markets.filter((m) => m.categories.some((x) => x.toLowerCase() === c));
    }
    if (rfqOnly)
        markets = markets.filter((m) => m.isValid && m.rfqAllowed);
    const total = markets.length;
    if (limit)
        markets = markets.slice(0, limit);
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({ total, venue: adapter.venueId, markets }, null, 1),
            },
        ],
    };
});
server.tool('gryps_get_market', 'Full detail for one Gryps market: leverage, notional bounds, live fee schedule, funding epoch, categories.', { symbol: z.string().describe('e.g. BTC, XAU, SEIUSDT') }, async ({ symbol }) => {
    const market = await adapter.getMarket(symbol);
    return {
        content: [
            {
                type: 'text',
                text: market
                    ? JSON.stringify(market, null, 1)
                    : `No market found for "${symbol}" on ${adapter.venueId}.`,
            },
        ],
    };
});
server.tool('gryps_get_funding', 'Funding parameters for a Gryps market (epoch duration, max rate).', { symbol: z.string() }, async ({ symbol }) => {
    const funding = await adapter.getFunding(symbol);
    return {
        content: [
            {
                type: 'text',
                text: funding
                    ? JSON.stringify(funding, null, 1)
                    : `No funding data for "${symbol}".`,
            },
        ],
    };
});
server.tool('gryps_open_interest', 'Aggregated open interest snapshot for the venue (raw upstream shape, timestamped).', {}, async () => {
    const oi = await adapter.getAggregatedOpenInterest();
    return {
        content: [{ type: 'text', text: JSON.stringify(oi, null, 1) }],
    };
});
const rollup = new PolygonRollupAdapter();
server.tool('gryps_venue_liveness', 'Chain-side venue heartbeat for Gryps v2 (PerpsRollup on Polygon): state root, sequence number, USDC custody, current implementation. Works even when the venue API is down — the chain is the truth source.', {}, async () => {
    const hb = await rollup.heartbeat();
    return {
        content: [{ type: 'text', text: JSON.stringify(hb, null, 1) }],
    };
});
const QUIRKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'quirks');
server.tool('gryps_venue_quirks', 'Venue Quirks Registry: dated, verified operational quirks with machine-actionable agent rules (fee conventions, funding grids, accounting identities, API churn). Filter by venue and/or severity.', {
    venueId: z.string().optional().describe('e.g. gryps-orbs-v1, gryps-v2-polygon'),
    severity: z.enum(['info', 'caution', 'breaking']).optional(),
}, async ({ venueId, severity }) => {
    const files = readdirSync(QUIRKS_DIR).filter((f) => f.endsWith('.json'));
    const venues = files
        .map((f) => JSON.parse(readFileSync(join(QUIRKS_DIR, f), 'utf8')))
        .filter((v) => !venueId || v.venue_id === venueId)
        .map((v) => ({
        ...v,
        quirks: v.quirks.filter((q) => !severity || q.severity === severity),
    }));
    return {
        content: [{ type: 'text', text: JSON.stringify(venues, null, 1) }],
    };
});
const transport = new StdioServerTransport();
await server.connect(transport);
