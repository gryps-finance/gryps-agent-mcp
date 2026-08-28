# Backend Integration Status

Verified 2026-08-28 against `https://perps-api.orbs.network`.

## What is live

| Capability | Endpoint | Variant status |
|---|---|---|
| Health and build | `GET /health` | Public MCP tool |
| Venue config | `GET /api/v1/config` | Public MCP tool |
| Markets and prices | `GET /api/v1/markets`, `GET /api/v1/prices` | Public MCP tools |
| Risk and fee tiers | `GET /api/v1/risk-config` | Public MCP tool |
| Account snapshot | `GET /api/v1/user/{address}` | Private observer |
| Portfolio | `GET /api/v1/user/{address}/portfolio` | Private observer |
| Order history | `GET /api/v1/user/{address}/orders/history` | Private observer |
| Trades/fills | `GET /api/v1/user/{address}/trades` | Private observer |

The public package contains only the first four capabilities. The private
observer source and build output are explicitly excluded from the npm tarball.
It fixes one wallet address at process start so an agent cannot enumerate an
arbitrary address through tool input.

## What Mango established

Mango's `engineWire.ts` maps the same live reads plus signed `POST /api/v1/order`,
`DELETE /api/v1/order/{orderId}`, and `POST /api/v1/auth/login`. Its write
adapter also constructs EIP-712 orders and preserves idempotency and unknown
outcomes. This is credible implementation against the Bot API guide, but it is
not yet evidence of a production-safe trading loop.

## Missing proof before execution

- Current versioned API contract or OpenAPI publication; common documentation
  paths returned 404 during this verification.
- A non-empty owned test account to validate every account field and pagination.
- Staging access and a reproducible session-key registration/revocation drill.
- A signed order, cancel, reduce-only close, and fill reconciliation on staging.
- Query-by-request-id or an agreed deterministic fallback for unknown outcomes.
- Confirmed session-key scope, expiry units, withdrawal exclusion, and key
  revocation semantics.
- Fee-basis decision and measured spread/slippage.
- Backend owner, compatibility policy, rate limits, incident path, and SLO.

## Capability ladder

1. `public-read`: anonymous venue facts; npm alpha target.
2. `internal-observer`: one configured account; private, no signing.
3. `execution-gateway`: separate process; mandate + signer + reconciliation.
4. `supervised-live`: G1-G6 and the $50-100 G5 test.
5. `agentic-live`: only after supervised evidence and formal operating approval.

No normal update of `@gryps/agent-mcp` may move a user up this ladder.
