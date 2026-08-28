/**
 * Guided prompt library and journey routing.
 *
 * A user who installs an MCP server rarely knows what to ask it. This module
 * answers that: a staged library of prompts, and a next-step recommender that
 * knows where someone is in the journey rather than dumping a catalogue.
 *
 * The doctrine it enforces, in order of importance:
 *
 * 1. Below the money line (read-only and paper) exploration is free and
 *    maximal. Nothing is withheld from someone who has risked nothing.
 * 2. Above the money line (anything live) is withheld until the caller states
 *    the funding station is complete, or asks for it deliberately.
 * 3. Safety is never gated. A recovery prompt is surfaced exactly when it is
 *    needed, which is precisely when someone is least able to go looking.
 *
 * This package cannot trade. The live-stage prompts are guidance for a journey
 * that continues outside it, not capability it holds. That distinction is
 * carried in the responses so an agent cannot mistake the map for the territory.
 */

import { PROMPT_MANIFEST } from './library-data.js'
import { PublicMcpError } from './errors.js'

export const STAGES = ['land', 'orient', 'shape', 'rehearse', 'fund', 'operate'] as const
export const LEVELS = ['never-used-an-agent', 'used-agents', 'traded-perps', 'built-bots'] as const
export const PURPOSES = ['understand', 'strategize', 'configure', 'operate', 'audit', 'recover'] as const
export const AUTONOMIES = ['read-only', 'paper', 'live-supervised', 'live-autonomous'] as const

export type Stage = (typeof STAGES)[number]
export type Level = (typeof LEVELS)[number]
export type Purpose = (typeof PURPOSES)[number]
export type Autonomy = (typeof AUTONOMIES)[number]

export interface PromptEntry {
  id: string
  title: string
  stage: Stage
  level: Level
  purpose: Purpose
  autonomy: Autonomy
  tier: 'open' | 'pro'
  nextPrompts: string[]
  whatItDoes: string
  whyItMatters: string
}

export interface PromptManifest {
  libraryVersion: string
  generated: string
  moneyLine: string
  journeySpine: string[]
  prompts: PromptEntry[]
}

const ABOVE_MONEY_LINE: readonly Autonomy[] = ['live-supervised', 'live-autonomous']

export function isAboveMoneyLine(prompt: PromptEntry): boolean {
  return ABOVE_MONEY_LINE.includes(prompt.autonomy)
}

/**
 * Whether a prompt may be surfaced. `explicit` is true when the caller asked
 * for this autonomy level by name, which is a deliberate act rather than
 * browsing, and is therefore allowed to reach live-supervised material.
 */
export function isSurfaceable(prompt: PromptEntry, fundStationComplete: boolean, explicit: boolean): boolean {
  if (prompt.purpose === 'recover') return true
  if (!isAboveMoneyLine(prompt)) return true
  if (prompt.autonomy === 'live-autonomous' && !fundStationComplete) return false
  return fundStationComplete || explicit
}

export interface LibraryFilter {
  stage?: Stage | undefined
  level?: Level | undefined
  purpose?: Purpose | undefined
  autonomy?: Autonomy | undefined
  text?: string | undefined
  fundStationComplete?: boolean | undefined
}

export interface LibraryResult {
  libraryVersion: string
  moneyLine: string
  matched: number
  results: PromptEntry[]
  withheld: { count: number; ids: string[]; reason: string }
  note: string
}

export function queryLibrary(filter: LibraryFilter = {}): LibraryResult {
  const funded = filter.fundStationComplete === true
  const explicitAutonomy = filter.autonomy !== undefined
  const text = filter.text?.trim().toLowerCase()

  const matches = PROMPT_MANIFEST.prompts.filter((prompt) => {
    if (filter.stage && prompt.stage !== filter.stage) return false
    if (filter.level && prompt.level !== filter.level) return false
    if (filter.purpose && prompt.purpose !== filter.purpose) return false
    if (filter.autonomy && prompt.autonomy !== filter.autonomy) return false
    if (text) {
      const haystack = `${prompt.id} ${prompt.title} ${prompt.whatItDoes} ${prompt.whyItMatters}`.toLowerCase()
      if (!haystack.includes(text)) return false
    }
    return true
  })

  const results: PromptEntry[] = []
  const withheldIds: string[] = []
  for (const prompt of matches) {
    if (isSurfaceable(prompt, funded, explicitAutonomy)) results.push(prompt)
    else withheldIds.push(prompt.id)
  }

  return {
    libraryVersion: PROMPT_MANIFEST.libraryVersion,
    moneyLine: PROMPT_MANIFEST.moneyLine,
    matched: matches.length,
    results,
    withheld: {
      count: withheldIds.length,
      ids: withheldIds,
      reason: withheldIds.length
        ? 'Withheld until the funding station is complete, or until requested deliberately by autonomy level. Exploration below the money line is never withheld, and recovery prompts are never withheld at all.'
        : 'Nothing withheld.',
    },
    note: withheldIds.length
      ? `${results.length} of ${matches.length} matching prompts surfaced. ${withheldIds.length} sit above the money line (${PROMPT_MANIFEST.moneyLine}).`
      : `${results.length} prompt(s) surfaced. All matches are below the money line or already unlocked.`,
  }
}

export interface NextStepResult {
  libraryVersion: string
  journeySpine: string[]
  currentPromptId: string | null
  stagePosition: string
  recommended: PromptEntry[]
  reason: string
  capabilityBoundary: string
}

const CAPABILITY_BOUNDARY =
  'These are prompts for you to run, not actions this server takes. The journey continues past what this package can do: it reads public venue data and never trades, signs, or holds assets. Live stages require tooling and authority that live outside this package.'

/**
 * Journey-aware recommendation. With no current prompt, this returns the start
 * of the spine rather than a catalogue, because the common failure of a fresh
 * install is not too few options but too many.
 */
export function nextStep(input: { currentPromptId?: string | undefined; fundStationComplete?: boolean | undefined } = {}): NextStepResult {
  const funded = input.fundStationComplete === true
  const byId = new Map(PROMPT_MANIFEST.prompts.map((prompt) => [prompt.id, prompt]))
  const spine = PROMPT_MANIFEST.journeySpine

  const base = {
    libraryVersion: PROMPT_MANIFEST.libraryVersion,
    journeySpine: spine,
    capabilityBoundary: CAPABILITY_BOUNDARY,
  }

  if (!input.currentPromptId) {
    const firstId = spine[0]
    const first = firstId ? byId.get(firstId) : undefined
    return {
      ...base,
      currentPromptId: null,
      stagePosition: first ? `start of the journey (${first.stage})` : 'unknown',
      recommended: first ? [first] : [],
      reason: 'Fresh start. Begin at the top of the journey spine rather than browsing the whole library.',
    }
  }

  const current = byId.get(input.currentPromptId)
  if (!current) {
    throw new PublicMcpError(
      'not_found',
      `Unknown prompt id "${input.currentPromptId}". Use gryps_prompt_library to list valid ids.`,
    )
  }

  const candidates = current.nextPrompts
    .map((id) => byId.get(id))
    .filter((prompt): prompt is PromptEntry => prompt !== undefined)

  const surfaceable = candidates.filter((prompt) => isSurfaceable(prompt, funded, false))
  const spineIndex = spine.indexOf(current.id)

  return {
    ...base,
    currentPromptId: current.id,
    stagePosition:
      spineIndex >= 0
        ? `step ${spineIndex + 1} of ${spine.length} on the spine (${current.stage})`
        : `off-spine prompt in the ${current.stage} stage`,
    recommended: surfaceable,
    reason: surfaceable.length
      ? `After ${current.id} (${current.stage}), the journey continues to: ${surfaceable.map((p) => `${p.id} (${p.stage})`).join(', ')}.`
      : `Every next step after ${current.id} sits above the money line (${PROMPT_MANIFEST.moneyLine}) and is withheld until the funding station is complete. That is the gate working, not an error.`,
  }
}

export function libraryStats() {
  const count = (key: 'stage' | 'autonomy' | 'purpose') =>
    PROMPT_MANIFEST.prompts.reduce<Record<string, number>>((totals, prompt) => {
      const value = prompt[key]
      totals[value] = (totals[value] ?? 0) + 1
      return totals
    }, {})
  return {
    libraryVersion: PROMPT_MANIFEST.libraryVersion,
    generated: PROMPT_MANIFEST.generated,
    total: PROMPT_MANIFEST.prompts.length,
    byStage: count('stage'),
    byAutonomy: count('autonomy'),
    byPurpose: count('purpose'),
  }
}
