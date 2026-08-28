# Changelog

## Unreleased (0.1.0-alpha.2)

- Added a single automatic retry with backoff for transient upstream failures
  (network errors, HTTP 429/5xx). Non-retryable statuses fail immediately.
- Added an oversized-response guard on upstream bodies (5 MB cap).
- Bounded the read cache size in both the public client and the internal
  observer, and added in-flight request deduplication to the observer.
- Query strings are now stripped from configured endpoints so override URLs
  cannot smuggle credentials or break path joining.
- Added `--help` / `--version` CLI flags and graceful SIGINT/SIGTERM shutdown.
- The internal observer clamps pagination bounds before they reach the
  upstream URL, even when used as a library.
- `createPublicServer` accepts an options object (fetcher, clock, retry delay)
  for deterministic end-to-end testing; public API is otherwise unchanged.
- Added end-to-end MCP wire tests over an in-memory transport, plus tests for
  retry behaviour, pagination, ambiguity, and missing-price limitations.
- Added GitHub Actions CI (Linux + Windows), a nightly live-contract check,
  Dependabot, CODEOWNERS, a PR boundary checklist, CONTRIBUTING.md, and
  ROADMAP.md.

## 0.1.0-alpha.1

- Added a public read-only MCP server over stdio.
- Added live Gryps v2 market catalogue, exact market detail, fee schedule, and
  venue status tools.
- Added exact symbol and base-asset resolution. Substring matches are refused.
- Added typed response envelopes with source, freshness, schema version, and
  limitations.
- Added strict upstream response validation, request timeouts, short-lived
  caching, and sanitised errors.
- Added release tests proving the public tool allowlist and npm tarball boundary.
