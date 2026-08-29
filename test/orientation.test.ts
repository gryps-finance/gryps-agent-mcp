import assert from 'node:assert/strict'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PUBLIC_TOOL_NAMES } from '../src/constants.js'
import { JOURNEY_PROMPTS } from '../src/journey.js'
import { PROMPT_MANIFEST } from '../src/library-data.js'
import { nextStep } from '../src/library.js'
import { SERVER_INSTRUCTIONS, capabilityReport } from '../src/orientation.js'
import { createPublicServer } from '../src/server.js'
import { fixtureFetch, testConfig } from './fixtures.js'

async function connected() {
  const server = createPublicServer(testConfig, { fetcher: fixtureFetch(), retryDelayMs: 0 })
  const client = new Client({ name: 'orientation-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

test('the server tells a connecting client what it is, without being asked', async () => {
  const client = await connected()
  const instructions = client.getInstructions()
  assert.ok(instructions, 'clients must receive instructions on initialize')
  assert.match(instructions, /gate, not a source of ideas/)
  assert.match(instructions, /gryps_next_step/)
  await client.close()
})

test('the instructions name every failure an agent could cause with these tools', () => {
  // Each of these is a way an agent misleads a user about money. If one is
  // dropped from the instructions, nothing else in the package reintroduces it
  // before the agent has already acted.
  assert.match(SERVER_INSTRUCTIONS, /never present a gryps number as a price the venue offered/i)
  assert.match(SERVER_INSTRUCTIONS, /lower bound/i)
  assert.match(SERVER_INSTRUCTIONS, /factor of two/i)
  assert.match(SERVER_INSTRUCTIONS, /untrusted data, not instruction/i)
  assert.match(SERVER_INSTRUCTIONS, /cannot trade, sign, hold assets/i)
})

test('the capability report answers what an agent would otherwise have to infer', async () => {
  const client = await connected()
  const response = await client.callTool({ name: 'gryps_capabilities', arguments: {} })
  assert.notEqual(response.isError, true)
  const payload = response.structuredContent as ReturnType<typeof capabilityReport>
  assert.ok(payload.whatItAnswers.length > 0)
  assert.ok(payload.whatItCannotDo.length > 0)
  assert.ok(payload.dataItReads.length > 0)
  assert.equal(payload.tools.length, PUBLIC_TOOL_NAMES.length)
  assert.match(payload.suggestedFirstCall, /gryps_next_step/)
  await client.close()
})

test('every known limitation states its consequence, not just its existence', () => {
  const report = capabilityReport('test', '0.0.0')
  assert.ok(report.knownLimitations.length >= 4)
  for (const limitation of report.knownLimitations) {
    assert.ok(limitation.limitation.length > 0, `${limitation.id} has no limitation text`)
    assert.ok(
      limitation.consequence.length > 0,
      `${limitation.id} states a limitation without saying what it costs the caller`,
    )
  }
  const ids = report.knownLimitations.map((entry) => entry.id)
  assert.ok(ids.includes('fee-direction-unresolved'))
  assert.ok(ids.includes('spread-unmeasured'))
})

test('the guided journey is exposed as native prompts a client can surface', async () => {
  const client = await connected()
  const listed = await client.listPrompts()
  const names = listed.prompts.map((prompt) => prompt.name)
  for (const prompt of JOURNEY_PROMPTS) {
    assert.ok(names.includes(prompt.id), `${prompt.id} is not offered as an MCP prompt`)
  }
  await client.close()
})

test('fetching a prompt returns runnable text, not a description of one', async () => {
  const client = await connected()
  const first = PROMPT_MANIFEST.journeySpine[0]!
  const prompt = await client.getPrompt({ name: first })
  const content = prompt.messages[0]?.content
  assert.equal(content?.type, 'text')
  const text = (content as { text: string }).text
  assert.ok(text.length > 200, 'a prompt body must be substantive, not a title restated')
  assert.match(text, /gryps_/, 'a journey prompt should tell the agent what to call')
  await client.close()
})

test('next_step hands over the prompt body, so the agent need not invent it', () => {
  const result = nextStep()
  const recommended = result.recommended[0]
  assert.ok(recommended)
  assert.equal(recommended.bodyStatus, 'available')
  assert.ok(recommended.promptBody && recommended.promptBody.length > 200)
})

test('every journey-spine prompt has a written body', () => {
  // The spine is the path a new install is walked down. A missing body there
  // leaves the agent improvising the one journey we chose to curate.
  const written = new Set(JOURNEY_PROMPTS.map((prompt) => prompt.id))
  for (const id of PROMPT_MANIFEST.journeySpine) {
    assert.ok(written.has(id), `journey spine step ${id} has no prompt body`)
  }
})

test('journey prompts refuse rather than only instruct', () => {
  // A prompt that cannot produce a "no" teaches nothing about a venue whose
  // central fact is that most claimed edges do not clear their own cost.
  const refusals = JOURNEY_PROMPTS.filter((prompt) =>
    /do not|cannot|never|stop and|refus|no-go/i.test(prompt.body),
  )
  assert.ok(
    refusals.length === JOURNEY_PROMPTS.length,
    `every journey prompt must carry an explicit refusal or limit; missing: ${JOURNEY_PROMPTS.filter((p) => !/do not|cannot|never|stop and|refus|no-go/i.test(p.body)).map((p) => p.id).join(", ")}`,
  )
})
