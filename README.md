# @gryps/agent-mcp

Read-mode MCP server for Gryps venue state — the first shipped artifact of the
**Gryps Agentic** product line (Tier 2, churn-proof build plan 2026-07-10).

Claude (or any MCP client) can read live Gryps markets, fee schedules, funding
parameters, and open interest. **Read-only by design** — no order placement,
no signing, no custody surface. Write mode ships later behind the same
adapter seam, gated on the venue rollout plan.

## Design rules

1. **One seam.** Only `src/adapters/gryps-orbs.ts` knows the upstream API's
   shape (ADR-002). Backend changes are absorbed in one file.
2. **Fees are data.** Fee schedules, leverage, and symbols are read live from
   the venue registry on every call — never hardcoded. The registry already
   carries multiple fee tiers per symbol; dynamic fees arrive as a data change.
3. **Explicit config** (ADR-009). No silent env-var reads. Override endpoints
   with `--solver-base=` / `--app-api-base=` flags.
4. **Drift-guarded.** Pair with `tools/api_drift_sentinel.py` on a schedule;
   bump `apiVersionPin` in the adapter when the sentinel reports change.

## Install / run

```bash
npm install && npm run build
node dist/index.js
```

Claude Desktop config:

```json
{
  "mcpServers": {
    "gryps": { "command": "node", "args": ["/path/to/dist/index.js"] }
  }
}
```

## Tools

| Tool | Description |
|---|---|
| `gryps_list_markets` | List markets; filter by category (Commodities, Stocks, RWA…) or RFQ availability |
| `gryps_get_market` | Full per-market detail incl. live fee schedule + notional bounds |
| `gryps_get_funding` | Funding epoch + max rate for a symbol |
| `gryps_open_interest` | Aggregated OI snapshot, timestamped |

## Status

v0.1 — concept-grade scaffold, compiles standalone. Not yet published;
externalization gated on the Gryps Agentic ownership conversation
(Agentic MOC open loop #1).
