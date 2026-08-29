#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { parseConfig } from './config.js'
import { PACKAGE_NAME, PACKAGE_VERSION } from './constants.js'
import { errorEnvelope } from './errors.js'
import { formatSelfCheck, runSelfCheck } from './selfcheck.js'
import { createPublicServer } from './server.js'

const args = process.argv.slice(2)

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write(`${PACKAGE_NAME} ${PACKAGE_VERSION}\n`)
  process.exit(0)
}

if (args.includes('--verify')) {
  const result = runSelfCheck()
  process.stdout.write(
    args.includes('--json') ? `${JSON.stringify(result, null, 2)}\n` : formatSelfCheck(result),
  )
  process.exit(result.passed ? 0 : 1)
}

if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    [
      `${PACKAGE_NAME} ${PACKAGE_VERSION}`,
      'Public read-only MCP server for live Gryps v2 market and venue data (stdio transport).',
      '',
      'Usage: gryps-agent-mcp [options]',
      '',
      'Options:',
      '  --api-base=<url>      HTTPS read API base (default: Gryps v2 public endpoint)',
      '  --health-url=<url>    HTTPS health endpoint',
      '  --timeout-ms=<int>    Upstream request timeout, 1-60000 (default: 10000)',
      '  --cache-ttl-ms=<int>  Read cache TTL, 1-60000 (default: 10000)',
      '  --verify              Audit this installed copy against its read-only claim',
      '  --verify --json       The same audit as machine-readable JSON',
      '  --version, -v         Print the package version and exit',
      '  --help, -h            Print this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

try {
  const config = parseConfig(args)
  const server = createPublicServer(config)
  const transport = new StdioServerTransport()

  const shutdown = () => {
    void server.close().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await server.connect(transport)
} catch (error) {
  process.stderr.write(`${JSON.stringify(errorEnvelope(error))}\n`)
  process.exitCode = 1
}
