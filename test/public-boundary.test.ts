import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { PACKAGE_NAME, PACKAGE_VERSION, PUBLIC_TOOL_NAMES } from '../src/constants.js'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  })
}

test('public tool allowlist is frozen', () => {
  assert.deepEqual([...PUBLIC_TOOL_NAMES], [
    'gryps_list_markets',
    'gryps_get_market',
    'gryps_venue_status',
    'gryps_friction_floor',
    'gryps_get_fee_schedule',
    'gryps_edge_check',
    'gryps_signal_stack',
    'gryps_route_compare',
    'gryps_indicative_quote',
    'gryps_reference_price',
    'gryps_next_step',
    'gryps_prompt_library',
  ])
})

test('no internal strategy surface reaches the public allowlist', () => {
  const joined = PUBLIC_TOOL_NAMES.join(' ')
  for (const forbidden of [/leadlag/i, /lead_lag/i, /slipstream/i, /backtest/i, /account/i, /wallet/i]) {
    assert.doesNotMatch(joined, forbidden)
  }
})

test('runtime identity is sourced from package metadata', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { name: string; version: string }
  assert.equal(PACKAGE_NAME, manifest.name)
  assert.equal(PACKAGE_VERSION, manifest.version)
})

test('source tree contains no execution or credential implementation', () => {
  const source = sourceFiles(fileURLToPath(new URL('../src', import.meta.url)))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
  const forbidden = [
    /signTypedData/,
    /placeOrder/,
    /submitIntent/,
    /privateKey/,
    /walletClient/,
    /from ['"]node:http['"]/,
    /createServer\(/,
    /\.listen\(/,
    /StdioServerTransport.*createServer/s,
  ]
  for (const pattern of forbidden) assert.doesNotMatch(source, pattern)
})
