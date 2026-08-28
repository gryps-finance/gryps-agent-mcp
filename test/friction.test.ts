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

test('reports both readings while the fee direction is unresolved', async () => {
  const sample = await new FrictionService(client()).sample('BTCUSDT')
  assert.equal(sample.feeDirection.resolved, false)
  assert.equal(sample.feeDirection.assumed, 'per-side')
  assert.equal(sample.feeDirection.engineReportedBps, 12)
  assert.equal(sample.feeDirection.roundTripBpsIfPerSide, 24)
  assert.equal(sample.feeDirection.roundTripBpsIfRoundTrip, 12)
  assert.match(sample.feeDirection.note, /UNRESOLVED/)
  assert.match(sample.limitations.join(' '), /24 bps under that reading and 12 bps under the other/)
})

test('marks the direction resolved when an operator declares it, either way', async () => {
  const roundTrip = await new FrictionService(client(), { feeIsRoundTrip: true }).sample('BTCUSDT')
  assert.equal(roundTrip.feeDirection.resolved, true)
  assert.equal(roundTrip.feeDirection.assumed, 'round-trip')
  assert.doesNotMatch(roundTrip.limitations.join(' '), /does not state fee direction/)

  // Declaring per side is not the same as never having asked.
  const perSide = await new FrictionService(client(), { feeIsRoundTrip: false }).sample('BTCUSDT')
  assert.equal(perSide.feeDirection.resolved, true)
  assert.equal(perSide.feeDirection.assumed, 'per-side')
  assert.equal(perSide.quote.roundTripBps, 24)
  assert.match(perSide.basisNote, /operator-declared/)
})

test('the fee-direction interval includes measured spread on both sides', async () => {
  const sample = await new FrictionService(client(), { spreadBpsPerSide: 8 }).sample('BTCUSDT')
  assert.equal(sample.feeDirection.roundTripBpsIfPerSide, 24 + 16)
  assert.equal(sample.feeDirection.roundTripBpsIfRoundTrip, 12 + 16)
})

test('names the absent engine spread surface rather than implying spread is zero', async () => {
  const sample = await new FrictionService(client()).sample('BTCUSDT')
  assert.equal(sample.spreadSurface.status, 'absent')
  assert.equal(sample.spreadSurface.probedAtIso, '2026-08-28')
  assert.match(sample.spreadSurface.note, /absent upstream, not merely unwired/)

  const supplied = await new FrictionService(client(), { spreadBpsPerSide: 8 }).sample('BTCUSDT')
  assert.equal(supplied.spreadSurface.status, 'operator-supplied')
})
