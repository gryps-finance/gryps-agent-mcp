# Changelog

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
