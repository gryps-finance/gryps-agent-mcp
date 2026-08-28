#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { parseObserverConfig } from './config.js'
import { createObserverServer } from './server.js'

try {
  const config = parseObserverConfig(process.argv.slice(2))
  await createObserverServer(config).connect(new StdioServerTransport())
} catch (error) {
  const message = error instanceof Error ? error.message : 'Internal observer failed to start.'
  process.stderr.write(`${JSON.stringify({ status: 'error', message })}\n`)
  process.exitCode = 1
}
