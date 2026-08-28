#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { parseConfig } from './config.js'
import { errorEnvelope } from './errors.js'
import { createPublicServer } from './server.js'

try {
  const config = parseConfig(process.argv.slice(2))
  const server = createPublicServer(config)
  await server.connect(new StdioServerTransport())
} catch (error) {
  process.stderr.write(`${JSON.stringify(errorEnvelope(error))}\n`)
  process.exitCode = 1
}
