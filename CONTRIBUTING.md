# Contributing

## Ground rules

1. The public package is a read boundary. Pull requests that add execution,
   signing, credential handling, or a network listener to `src/` will be closed;
   see [ARCHITECTURE.md](ARCHITECTURE.md) and [ROADMAP.md](ROADMAP.md) §5 for
   where that work belongs.
2. The public tool allowlist (`PUBLIC_TOOL_NAMES`) is frozen. Changing it is a
   product decision, not a refactor.
3. Every response change must keep the versioned envelope contract
   (`schemaVersion`, `status`, `data`/`error`, `meta`).

## Workflow

```bash
npm ci
npm run verify:release   # typecheck, tests, build, MCP smoke, tarball boundary
npm run verify:internal  # observer profile
npm run smoke:live       # optional; needs network access to the public endpoint
```

- Node.js 22.13+ is required.
- Match the existing code style: no semicolons, single quotes, two-space indent,
  explicit `.js` extensions on relative imports.
- Add or update tests with every behaviour change; the CI matrix runs Linux and
  Windows, so avoid platform-specific paths.
- Update CHANGELOG.md under the unreleased heading.

## Reporting security issues

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
