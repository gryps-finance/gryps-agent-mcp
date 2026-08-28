import assert from 'node:assert/strict'
import test from 'node:test'
import { EngineReadClient } from '../src/client.js'
import { FrictionService } from '../src/friction.js'
import { PublicMcpError } from '../src/errors.js'
import { fixtureFetch, testConfig } from './fixtures.js'

function client() {
  return new EngineReadClient({ config: testConfig, fetcher: fixtureFetch(), retryDelayMs: 0 })
}

test('treats the engine fee rate as per side and doubles it by default', async () => {
  const sample = await new FrictionService(client()).sample('BTCUSDT')
  // Fixture tier 0 reports 12 bps. Per-side reading gives a 24 bps round trip.
  assert.equal(sample.quote.protocolFeeBps, 24)
  assert.equal(sample.quote.roundTripBps, 24)
  assert.match(sample.basisNote, /PER SIDE \(unverified\)/)
})

test('halves the rate once the round-trip basis is confirmed', async () => {
  const sample = await new FrictionService(client(), { feeIsRoundTrip: true }).sample('BTCUSDT')
  assert.equal(sample.quote.roundTripBps, 12)
  assert.match(sample.basisNote, /ROUND TRIP/)
})

test('reports a lower bound while spread is unmeasured', async () => {
  const sample = await new FrictionService(client()).sample('BTCUSDT')
  assert.equal(sample.isLowerBound, true)
  assert.equal(sample.spreadBasis, 'unmeasured')
  assert.equal(sample.quote.openSpreadBps, 0)
  assert.match(sample.limitations.join(' '), /measured fee floor, not all-in friction/)
})

test('includes operator-supplied spread and stops calling itself a lower bound', async () => {
  const sample = await new FrictionService(client(), { spreadBpsPerSide: 8 }).sample('BTCUSDT')
  assert.equal(sample.isLowerBound, false)
  assert.equal(sample.spreadBasis, 'operator-supplied')
  assert.equal(sample.quote.roundTripBps, 24 + 16)
  assert.doesNotMatch(sample.limitations.join(' '), /Spread is not measured/)
})

test('prices a better fee tier without inventing one that does not exist', async () => {
  const cheap = await new FrictionService(client(), { tierLevel: 9 }).sample('BTCUSDT')
  assert.equal(cheap.quote.roundTripBps, 0)

  await assert.rejects(
    () => new FrictionService(client(), { tierLevel: 4 }).sample('BTCUSDT'),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'not_found',
  )
})
