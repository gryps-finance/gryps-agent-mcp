import assert from 'node:assert/strict'
import test from 'node:test'
import { parseConfig } from '../src/config.js'
import { PublicMcpError } from '../src/errors.js'

test('uses explicit stable defaults and ignores the environment', () => {
  const config = parseConfig([])
  assert.equal(config.apiBase, 'https://perps-api.orbs.network/api/v1')
  assert.equal(config.healthUrl, 'https://perps-api.orbs.network/health')
})

test('accepts loopback HTTP for development', () => {
  const config = parseConfig([
    '--api-base=http://127.0.0.1:9000/api/v1',
    '--health-url=http://localhost:9000/health',
  ])
  assert.match(config.apiBase, /^http:\/\/127\.0\.0\.1/)
})

test('rejects insecure remote HTTP and credential-bearing URLs', () => {
  for (const args of [
    ['--api-base=http://example.com/api/v1'],
    ['--api-base=https://user:pass@example.com/api/v1'],
  ]) {
    assert.throws(
      () => parseConfig(args),
      (error: unknown) => error instanceof PublicMcpError && error.code === 'invalid_configuration',
    )
  }
})
