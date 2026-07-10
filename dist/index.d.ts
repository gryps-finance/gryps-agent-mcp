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
export {};
