import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SYMBOL_ALIASES,
  editDistance,
  expandQuery,
  matchesSubstring,
  nearestMarkets,
  normalise,
} from '../src/symbols.js'

const catalogue = [
  { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', displayName: 'BTC/USDT' },
  { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', displayName: 'ETH/USDT' },
  { symbol: 'POLUSDT', baseAsset: 'POL', quoteAsset: 'USDT', displayName: 'POL/USDT' },
  { symbol: '1000SHIBUSDT', baseAsset: '1000SHIB', quoteAsset: 'USDT', displayName: '1000SHIB/USDT' },
]

test('normalises the separators people put in pair names', () => {
  assert.equal(normalise(' btc/usdt '), 'BTCUSDT')
  assert.equal(normalise('btc-usdt'), 'BTCUSDT')
  assert.equal(normalise('shiba inu'), 'SHIBAINU')
})

test('rewrites a common name to the ticker the venue actually lists', () => {
  assert.deepEqual(expandQuery('bitcoin'), { requested: 'BITCOIN', searched: 'BTC', aliasApplied: 'BTC' })
  // The venue lists POL, not MATIC. An out-of-date caller still finds it.
  assert.equal(expandQuery('matic').searched, 'POL')
  assert.equal(expandQuery('polygon').searched, 'POL')
  assert.equal(expandQuery('shiba inu').searched, 'SHIB')
})

test('leaves an unknown or already-canonical query untouched', () => {
  assert.deepEqual(expandQuery('BTCUSDT'), { requested: 'BTCUSDT', searched: 'BTCUSDT', aliasApplied: null })
  // An alias must never assert a market exists; it only rewrites the query.
  assert.deepEqual(expandQuery('toncoin'), { requested: 'TONCOIN', searched: 'TONCOIN', aliasApplied: null })
})

test('the alias table only points at tickers, never at whole symbols', () => {
  // A target that carried a quote suffix would break substring search for any
  // market that pairs the same base against something else.
  for (const target of Object.values(SYMBOL_ALIASES)) {
    assert.doesNotMatch(target, /USDT$/)
    assert.equal(target, target.toUpperCase())
  }
})

test('finds a multiplied market through the base-asset alias', () => {
  const searched = expandQuery('shiba inu').searched
  assert.ok(catalogue.filter((market) => matchesSubstring(market, searched)).some((m) => m.symbol === '1000SHIBUSDT'))
})

test('measures edit distance for the suggestion ranking', () => {
  assert.equal(editDistance('BTC', 'BTC'), 0)
  assert.equal(editDistance('BTCUSD', 'BTCUSDT'), 1)
  assert.equal(editDistance('', 'BTC'), 3)
})

test('suggests the nearest listed symbols for a near miss', () => {
  const nearest = nearestMarkets(catalogue, 'BTCUSD')
  assert.equal(nearest[0]?.market.symbol, 'BTCUSDT')
})

test('suggests nothing for a query no listed symbol resembles', () => {
  assert.deepEqual(nearestMarkets(catalogue, 'COMPLETELYUNRELATED'), [])
})
