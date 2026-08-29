/**
 * The guided journey: the actual text a user runs, not just its title.
 *
 * The prompt library ships metadata about prompts. This file supplies the
 * bodies for the journey spine, which is the path a new install is walked
 * down. Without these, a next-step recommendation names a destination and
 * leaves the agent to invent the route.
 *
 * Each body is written to be pasted verbatim by a person, or executed directly
 * by an agent. They are instructions to the assistant, so they say what to
 * call, what to report, and what not to claim. The refusals matter as much as
 * the requests: a prompt that cannot fail teaches nothing about a venue whose
 * central fact is that most trades do not clear their own cost.
 */

export interface JourneyPrompt {
  id: string
  title: string
  /** One line shown in a picker before the body is read. */
  summary: string
  /** The text a user runs, or an agent executes. */
  body: string
}

export const JOURNEY_PROMPTS: JourneyPrompt[] = [
  {
    id: 'j0-first-contact',
    title: 'First Contact',
    summary: 'Talk to the venue before you trust it. No account, no money.',
    body: [
      'Use the Gryps tools to introduce me to this venue from scratch. Do all of this before drawing any conclusion:',
      '',
      '1. Call gryps_venue_status. Tell me whether the venue is healthy, which chain it settles on, and whether the settlement contract matches the pinned canonical one.',
      '2. Call gryps_list_markets with no query. Tell me roughly how many markets exist, but say plainly that the count has not been reconciled with published documentation and must not be repeated as a fact.',
      '3. Call gryps_get_market for BTC. Give me the live price and when it was observed.',
      '',
      'Then tell me, in two sentences, what you have actually established and what you have not. Do not tell me the venue is good, safe, or worth trading. You have checked that it is reachable and what it says about itself. That is all.',
    ].join('\n'),
  },
  {
    id: 'j1-the-honest-briefing',
    title: 'The Honest Briefing',
    summary: 'What this tool is, what it refuses to do, and where its numbers are uncertain.',
    body: [
      'Brief me honestly on what the Gryps tools can and cannot tell me. Use gryps_capabilities and gryps_friction_floor for BTC, then answer in your own words:',
      '',
      '1. What question is this server actually built to answer?',
      '2. What is the round-trip cost on BTC right now, and is that number a floor or a full cost? Explain what is missing from it.',
      '3. The fee direction is unresolved. Show me both readings and tell me what the difference is worth on the break-even number.',
      '4. Name three things this server will refuse to do.',
      '',
      'Do not reassure me. If the headline number could be double what it should be, say so in the first line of your answer.',
    ].join('\n'),
  },
  {
    id: 'j2-the-intake-interview',
    title: 'The Intake Interview',
    summary: 'Turn a vague trading idea into something that can actually be tested.',
    body: [
      'I want to test a trading idea against execution reality. Interview me first, then check it.',
      '',
      'Ask me, one at a time:',
      '- Which market, and roughly what size in USD?',
      '- Where did the idea come from, and how big a move does it expect, in percent or basis points?',
      '- How confident am I, from 0 to 1?',
      '- Is this a one-off, or something I would repeat many times?',
      '',
      'When you have all four, convert the expected move to basis points, then call gryps_edge_check with what I gave you. Report the verdict, the required edge, and every caveat it returns.',
      '',
      'If I gave you a number you cannot check, say which one and why, rather than guessing on my behalf.',
    ].join('\n'),
  },
  {
    id: 'j3-the-dry-run',
    title: 'The Dry Run',
    summary: 'Rehearse the whole loop with zero capital, and see friction take its cut.',
    body: [
      'Walk me through a full rehearsal with no money at risk. Use gryps_paper_session throughout.',
      '',
      '1. Open a paper position in BTC at a size I would realistically trade. Tell me the entry mark and the friction charged on the way in.',
      '2. Show me the status. Explain why an unchanged price already shows a small loss.',
      '3. Close it. Break the result into how much came from the price moving and how much friction took.',
      '',
      'Then tell me the lesson in one sentence. If friction ate a move that went my way, say that explicitly. That is the single most useful thing this rehearsal can teach, and it is the reason to do it before using real money.',
      '',
      'Remind me at the end that no order existed anywhere and this state disappears when the server stops.',
      '',
      'Do not tell me the strategy works because one paper trade went well. A single rehearsal shows me the mechanics and the cost, and nothing at all about edge.',
    ].join('\n'),
  },
  {
    id: 'j4-the-authorization',
    title: 'The Authorization',
    summary: 'What funding actually commits you to, before you commit to it.',
    body: [
      'Before I fund anything, make me argue for it.',
      '',
      'Using gryps_friction_floor and gryps_indicative_quote for the size I have in mind, tell me:',
      '- The all-in round-trip cost, and whether it is still a floor rather than a full cost.',
      '- What a realistic clip would look like: entry, quantity, total cost in dollars, not just basis points.',
      '- The minimum move, in percent, that leaves me flat after costs.',
      '',
      'Then ask me directly whether I have an edge that beats that number, and do not help me answer it. If I cannot state where my edge comes from, say that funding is premature.',
      '',
      'Note plainly: these Gryps tools cannot fund, sign, or trade anything. Whatever I do next happens elsewhere, with different tools and real authority.',
    ].join('\n'),
  },
  {
    id: 'j5-first-trade-ritual',
    title: 'The First Trade Ritual',
    summary: 'Smallest size, fullest proof. Check everything before anything is real.',
    body: [
      'I am about to place a real trade for the first time. Run the pre-flight, and be difficult about it.',
      '',
      '1. gryps_venue_status: is the venue healthy right now, and does the settlement contract match the pinned canonical one? If it does not match, stop and tell me not to proceed.',
      '2. gryps_get_market: is there a live price for my symbol, or a typed unavailable reason?',
      '3. gryps_friction_floor: what must the move beat?',
      '4. gryps_edge_check: does my actual claim clear that, at my real confidence?',
      '5. gryps_route_compare at my real size: is another venue cheaper? Tell me if it is, plainly.',
      '',
      'Then give me a go or no-go with the one reason that decided it. Recommend the smallest size that still proves the loop end to end. Placing the trade is not something you can do, and not something these tools can do.',
    ].join('\n'),
  },
  {
    id: 'j6-the-operating-loop',
    title: 'The Operating Loop',
    summary: 'The standing routine: re-check what changed, and what it costs you now.',
    body: [
      'This is my recurring check. Run it and keep it short.',
      '',
      '1. gryps_venue_status: healthy, and settlement still matching the pinned contract?',
      '2. gryps_friction_floor on the markets I am active in: has the cost to trade moved since last time?',
      '3. gryps_reference_price on the same markets: how far is the Gryps oracle from the external mid? Flag anything beyond a couple of basis points as worth a look.',
      '',
      'Report only what changed and what it means for whether my strategy still clears its costs. If nothing material changed, say so in one line rather than padding the report.',
      '',
      'If the friction floor has risen enough that a strategy that used to clear no longer does, lead with that.',
      '',
      'Do not infer a trend from two readings, and never tell me conditions are improving because cost fell once. You are reporting what changed, not forecasting.',
    ].join('\n'),
  },
]

export const JOURNEY_PROMPTS_BY_ID = new Map(JOURNEY_PROMPTS.map((prompt) => [prompt.id, prompt]))

export function journeyPromptBody(id: string): JourneyPrompt | undefined {
  return JOURNEY_PROMPTS_BY_ID.get(id)
}
