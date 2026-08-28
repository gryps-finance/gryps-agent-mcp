import assert from 'node:assert/strict'
import test from 'node:test'
import { PublicMcpError } from '../src/errors.js'
import {
  isAboveMoneyLine,
  libraryStats,
  nextStep,
  queryLibrary,
} from '../src/library.js'
import { PROMPT_MANIFEST } from '../src/library-data.js'

test('a fresh start returns one starting point, not a catalogue', () => {
  const result = nextStep()
  assert.equal(result.currentPromptId, null)
  assert.equal(result.recommended.length, 1)
  assert.equal(result.recommended[0]?.id, PROMPT_MANIFEST.journeySpine[0])
  assert.equal(result.recommended[0]?.autonomy, 'read-only')
  assert.match(result.reason, /Fresh start/)
})

test('the journey advances along the spine', () => {
  const first = PROMPT_MANIFEST.journeySpine[0]!
  const result = nextStep({ currentPromptId: first })
  assert.ok(result.recommended.length > 0)
  assert.match(result.stagePosition, /step 1 of/)
  assert.equal(result.recommended[0]?.id, PROMPT_MANIFEST.journeySpine[1])
})

test('an unknown prompt id is refused rather than silently returning nothing', () => {
  assert.throws(
    () => nextStep({ currentPromptId: 'does-not-exist' }),
    (error: unknown) => error instanceof PublicMcpError && error.code === 'not_found',
  )
})

test('exploration below the money line is never withheld', () => {
  const result = queryLibrary({ autonomy: 'read-only' })
  assert.equal(result.withheld.count, 0)
  assert.ok(result.results.length > 0)
  for (const prompt of result.results) assert.equal(isAboveMoneyLine(prompt), false)
})

test('live prompts are withheld while browsing, and unlocked by funding', () => {
  const browsing = queryLibrary({ stage: 'fund' })
  const funded = queryLibrary({ stage: 'fund', fundStationComplete: true })
  assert.ok(browsing.withheld.count > 0, 'fund-stage live prompts must be withheld by default')
  assert.ok(
    funded.results.length > browsing.results.length,
    'completing the funding station must surface more than browsing does',
  )
  assert.match(browsing.withheld.reason, /funding station/)
})

test('asking for a live autonomy level by name is treated as deliberate', () => {
  const browsing = queryLibrary({})
  const deliberate = queryLibrary({ autonomy: 'live-supervised' })
  assert.ok(browsing.withheld.count > 0)
  assert.equal(deliberate.withheld.count, 0, 'a named request is deliberate, not browsing')
  assert.ok(deliberate.results.length > 0)
})

test('recovery prompts are never gated, funded or not', () => {
  const result = queryLibrary({ purpose: 'recover' })
  assert.equal(result.withheld.count, 0)
  assert.ok(result.results.length > 0)
  // Safety guidance must reach someone who has not funded anything.
  const live = result.results.filter(isAboveMoneyLine)
  assert.ok(live.length > 0, 'the fixture should include live recovery prompts to make this meaningful')
})

test('free-text search matches intent, not just titles', () => {
  const result = queryLibrary({ text: 'venue' })
  assert.ok(result.results.length > 0)
})

test('a text search matching only gated prompts says so rather than returning a bare empty list', () => {
  // "killswitch" exists but sits above the money line, so browsing cannot see
  // it. Silently returning nothing would read as "no such thing", which is
  // worse than saying it exists and is locked.
  const result = queryLibrary({ text: 'killswitch' })
  assert.equal(result.results.length, 0)
  assert.ok(result.matched > 0, 'the prompt exists and must be counted as matched')
  assert.ok(result.withheld.count > 0)
  assert.match(result.withheld.reason, /funding station/)
})

test('every next-prompt reference resolves to a real prompt', () => {
  const ids = new Set(PROMPT_MANIFEST.prompts.map((prompt) => prompt.id))
  for (const prompt of PROMPT_MANIFEST.prompts) {
    for (const next of prompt.nextPrompts) {
      assert.ok(ids.has(next), `${prompt.id} points at missing prompt ${next}`)
    }
  }
  for (const id of PROMPT_MANIFEST.journeySpine) {
    assert.ok(ids.has(id), `journey spine references missing prompt ${id}`)
  }
})

test('every prompt says what it does', () => {
  for (const prompt of PROMPT_MANIFEST.prompts) {
    assert.ok(prompt.whatItDoes.length > 0, `${prompt.id} has no whatItDoes`)
  }
})

test('the guided journey itself is fully explained, even where the wider library is not', () => {
  // Only about half the library carries whyItMatters today. The spine is the
  // path a new user is actually walked down, so it is the part that must not
  // have gaps. The rest is a content backlog, not a release blocker.
  for (const id of PROMPT_MANIFEST.journeySpine) {
    const prompt = PROMPT_MANIFEST.prompts.find((candidate) => candidate.id === id)
    assert.ok(prompt, `spine references missing prompt ${id}`)
    assert.ok(prompt.whatItDoes.length > 0, `${id} has no whatItDoes`)
    assert.ok(prompt.whyItMatters.length > 0, `${id} has no whyItMatters`)
  }
})

test('library stats describe the shipped library', () => {
  const stats = libraryStats()
  assert.equal(stats.total, PROMPT_MANIFEST.prompts.length)
  assert.equal(stats.libraryVersion, PROMPT_MANIFEST.libraryVersion)
  assert.ok(stats.byStage.land! > 0)
})
