import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChainFeeSource,
  FEE_TOPICS,
  assessFeeDirection,
  decodeFeeObservation,
  symbolFromBytes32,
} from '../src/chainfees.js'
import { PublicMcpError } from '../src/errors.js'

/** Build ABI-encoded log data with the given words at the given indexes. */
function encode(words: Record<number, bigint | string>): string {
  const highest = Math.max(...Object.keys(words).map(Number))
  let out = '0x'
  for (let index = 0; index <= highest; index += 1) {
    const value = words[index]
    if (typeof value === 'string') out += value.padEnd(64, '0')
    else out += (value ?? 0n).toString(16).padStart(64, '0')
  }
  return out
}

const BTC_B32 = Buffer.from('BTCUSDT').toString('hex')

/** An OrderPlaced log: symbol at word 2, economics from word 5. */
function orderPlaced(feeTotal: bigint, notional: bigint, orderId = '11') {
  return {
    topics: [FEE_TOPICS.OrderPlaced],
    data: encode({
      1: orderId.padStart(64, '0'),
      2: BTC_B32,
      5: feeTotal,
      6: 0n,
      7: 0n,
      9: notional,
    }),
  }
}

test('decodes a symbol out of its bytes32 padding', () => {
  assert.equal(symbolFromBytes32(BTC_B32.padEnd(64, '0')), 'BTCUSDT')
})

test('computes a one-way fee as a share of notional', () => {
  // 10 USDC of fee on 10,000 USDC of notional is 10 bps.
  const observation = decodeFeeObservation(orderPlaced(10_000_000n, 10_000_000_000n))
  assert.ok(observation)
  assert.equal(observation.symbol, 'BTCUSDT')
  assert.equal(Math.round(observation.feeBpsOneWay), 10)
  assert.equal(observation.notionalUsdc, 10_000)
  assert.equal(observation.fromFill, false)
})

test('ignores logs that carry no fee economics', () => {
  assert.equal(decodeFeeObservation({ topics: ['0xdeadbeef'], data: '0x00' }), null)
  // Zero notional would divide by zero rather than mean a free trade.
  assert.equal(decodeFeeObservation(orderPlaced(5n, 0n)), null)
})

function sourceWith(pages: { items: unknown[]; next_page_params?: unknown }[]) {
  let call = 0
  const fetcher: typeof fetch = async () => {
    const page = pages[Math.min(call, pages.length - 1)]
    call += 1
    return new Response(JSON.stringify(page), { status: 200 })
  }
  return new ChainFeeSource({
    explorerUrl: 'https://explorer.example.test/api/v2',
    timeoutMs: 1_000,
    fetcher,
  })
}

test('takes the median of deduped fills rather than the mean of everything', async () => {
  const source = sourceWith([
    {
      items: [
        orderPlaced(4_000_000n, 10_000_000_000n, 'aa'), // 4 bps
        orderPlaced(10_000_000n, 10_000_000_000n, 'bb'), // 10 bps
        orderPlaced(200_000_000n, 10_000_000_000n, 'cc'), // 200 bps, an outlier
      ],
      next_page_params: null,
    },
  ])
  const result = await source.measure()
  // A mean would be dragged to 71 bps by the outlier. The median holds.
  assert.equal(result.medianOneWayBps, 10)
  assert.equal(result.roundTripBps, 20)
  assert.equal(result.sampleSize, 3)
})

test('counts one trade once, preferring the fill over its placement', async () => {
  const placed = orderPlaced(10_000_000n, 10_000_000_000n, 'dd')
  const filled = {
    topics: [FEE_TOPICS.TradeFilled],
    data: encode({ 1: 'dd'.padStart(64, '0'), 3: BTC_B32, 6: 4_000_000n, 7: 0n, 8: 0n, 10: 10_000_000_000n }),
  }
  const source = sourceWith([{ items: [placed, filled], next_page_params: null }])
  const result = await source.measure()
  assert.equal(result.sampleSize, 1, 'a placement and its fill are one trade')
  // The fill's economics win, not the placement's.
  assert.equal(Math.round(result.medianOneWayBps), 4)
})

test('falls back to a venue-wide median when one symbol has too few fills', async () => {
  const source = sourceWith([
    { items: [orderPlaced(10_000_000n, 10_000_000_000n, 'ee')], next_page_params: null },
  ])
  const result = await source.measure('ETHUSDT')
  assert.equal(result.scope, 'venue-wide')
  assert.equal(result.symbol, 'ETHUSDT')
})

test('refuses rather than reporting a fee from an empty window', async () => {
  const source = sourceWith([{ items: [], next_page_params: null }])
  await assert.rejects(
    () => source.measure(),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'not_found',
  )
})

test('a measured one-way fee discriminates between the two readings of the schedule', () => {
  // Advertised 12. If per side, a fill costs ~12; if round trip, ~6.
  const perSide = assessFeeDirection(12, 10, 20)
  assert.equal(perSide.evidence, 'supports-per-side')
  assert.equal(perSide.impliedOneWayIfRoundTrip, 6)

  const roundTrip = assessFeeDirection(12, 6.1, 20)
  assert.equal(roundTrip.evidence, 'supports-round-trip')
})

test('a measurement between the two readings settles nothing, and says so', () => {
  const finding = assessFeeDirection(12, 9, 20)
  assert.equal(finding.evidence, 'inconclusive')
  assert.match(finding.reasoning, /does not clearly favour either/)
})

test('every finding carries the caution that it is evidence, not confirmation', () => {
  for (const measured of [10, 6, 9]) {
    const finding = assessFeeDirection(12, measured, 14)
    assert.match(finding.caution, /not a confirmation from the protocol team/)
    assert.match(finding.caution, /different fee tiers/i)
  }
})
