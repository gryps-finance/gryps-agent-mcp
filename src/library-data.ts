/**
 * Prompt library data, generated from the Gryps prompt manifest.
 *
 * Embedded as a module rather than read from disk: the published package ships
 * only compiled output, and a runtime file read would break under npx.
 *
 * Do not hand-edit. Regenerate from the manifest when the library changes.
 */

import type { PromptManifest } from './library.js'

export const PROMPT_MANIFEST: PromptManifest = {
  "libraryVersion": "0.4.0",
  "generated": "2026-08-12",
  "moneyLine": "between paper and live-supervised",
  "journeySpine": [
    "j0-first-contact",
    "j1-the-honest-briefing",
    "j2-the-intake-interview",
    "j3-the-dry-run",
    "j4-the-authorization",
    "j5-first-trade-ritual",
    "j6-the-operating-loop"
  ],
  "prompts": [
    {
      "id": "j0-first-contact",
      "title": "First Contact — talk to the venue before you trust it",
      "stage": "land",
      "level": "never-used-an-agent",
      "purpose": "understand",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [
        "j1-the-honest-briefing"
      ],
      "whatItDoes": "First conversation with Gryps through your own AI. No account, no money.",
      "whyItMatters": "Trust starts with seeing what the agent sees."
    },
    {
      "id": "j1-the-honest-briefing",
      "title": "The Honest Briefing — what agents can and cannot do",
      "stage": "orient",
      "level": "never-used-an-agent",
      "purpose": "understand",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [
        "j2-the-intake-interview"
      ],
      "whatItDoes": "A sober, evidence-grounded briefing incl. the live friction number.",
      "whyItMatters": "Building for the right reasons beats rebuilding for the wrong ones."
    },
    {
      "id": "j2-the-intake-interview",
      "title": "The Intake Interview — your agent asks, you decide",
      "stage": "shape",
      "level": "never-used-an-agent",
      "purpose": "strategize",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [
        "j3-the-dry-run"
      ],
      "whatItDoes": "The AI interviews you and writes your operating mandate from your answers.",
      "whyItMatters": "A mandate you authored is the difference between an operator and a passenger."
    },
    {
      "id": "j3-the-dry-run",
      "title": "The Dry Run — watch it trade nothing, on purpose",
      "stage": "rehearse",
      "level": "never-used-an-agent",
      "purpose": "operate",
      "autonomy": "paper",
      "tier": "open",
      "nextPrompts": [
        "j4-the-authorization"
      ],
      "whatItDoes": "Paper session under your mandate against live data; narrated inaction.",
      "whyItMatters": "Trust is built watching it decline bad trades."
    },
    {
      "id": "j4-the-authorization",
      "title": "The Authorization — fund exactly what you intend",
      "stage": "fund",
      "level": "never-used-an-agent",
      "purpose": "configure",
      "autonomy": "live-supervised",
      "tier": "open",
      "nextPrompts": [
        "j5-first-trade-ritual"
      ],
      "whatItDoes": "Session key + small deposit + spoken-aloud review of exactly what's authorized.",
      "whyItMatters": "The one station where regret is possible, so it is the slowest by design."
    },
    {
      "id": "j5-first-trade-ritual",
      "title": "The First Trade Ritual — smallest size, fullest proof",
      "stage": "fund",
      "level": "never-used-an-agent",
      "purpose": "operate",
      "autonomy": "live-supervised",
      "tier": "open",
      "nextPrompts": [
        "j6-the-operating-loop"
      ],
      "whatItDoes": "One tiny ceremonial live trade with on-chain attestation proof and a pre-staged exit.",
      "whyItMatters": "After this, nothing the agent does is mysterious."
    },
    {
      "id": "j6-the-operating-loop",
      "title": "The Operating Loop — Neutral by Design standing mandate",
      "stage": "operate",
      "level": "never-used-an-agent",
      "purpose": "operate",
      "autonomy": "live-supervised",
      "tier": "open",
      "nextPrompts": [
        "b1-daily-activity-summary",
        "r1-something-looks-wrong",
        "d1-lite-prompt-injection-sentinel",
        "a3-risk-envelope-reasoner"
      ],
      "whatItDoes": "The starter agent's standing orders: default nothing, defend always, watch everything, report daily.",
      "whyItMatters": "An agent that defaults to nothing cannot bleed you while you learn."
    },
    {
      "id": "a1-decision-loop-scaffold",
      "title": "Decision Loop Scaffold",
      "stage": "shape",
      "level": "used-agents",
      "purpose": "strategize",
      "autonomy": "paper",
      "tier": "open",
      "nextPrompts": [
        "a4-multi-step-deliberation-chain"
      ],
      "whatItDoes": "Scaffold a rules-based decision loop your agent can execute.",
      "whyItMatters": ""
    },
    {
      "id": "a2-tool-use-planning-template",
      "title": "Tool-Use Planning Template",
      "stage": "shape",
      "level": "used-agents",
      "purpose": "strategize",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [
        "a1-decision-loop-scaffold"
      ],
      "whatItDoes": "Plan which venue tools a strategy actually needs before writing it.",
      "whyItMatters": ""
    },
    {
      "id": "a3-risk-envelope-reasoner",
      "title": "Risk Envelope Reasoner",
      "stage": "shape",
      "level": "used-agents",
      "purpose": "strategize",
      "autonomy": "paper",
      "tier": "open",
      "nextPrompts": [
        "j3-the-dry-run"
      ],
      "whatItDoes": "Reason an explicit risk envelope: sizes, stops, exposure ceilings.",
      "whyItMatters": ""
    },
    {
      "id": "a4-multi-step-deliberation-chain",
      "title": "Multi-Step Deliberation Chain",
      "stage": "shape",
      "level": "traded-perps",
      "purpose": "strategize",
      "autonomy": "paper",
      "tier": "open",
      "nextPrompts": [
        "a5-self-critique-loop"
      ],
      "whatItDoes": "Force multi-step deliberation before any intent forms.",
      "whyItMatters": ""
    },
    {
      "id": "a5-self-critique-loop",
      "title": "Self-Critique Loop",
      "stage": "shape",
      "level": "traded-perps",
      "purpose": "audit",
      "autonomy": "paper",
      "tier": "open",
      "nextPrompts": [
        "b4-first-trade-dry-run-reasoner"
      ],
      "whatItDoes": "The agent argues against its own proposed trade before proposing it.",
      "whyItMatters": ""
    },
    {
      "id": "b1-daily-activity-summary",
      "title": "Daily Activity Summary",
      "stage": "operate",
      "level": "never-used-an-agent",
      "purpose": "operate",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [
        "j6-the-operating-loop"
      ],
      "whatItDoes": "Plain-language daily report of actions, inactions, and measured costs.",
      "whyItMatters": ""
    },
    {
      "id": "b2-killswitch-pre-flight-verification",
      "title": "Killswitch Pre-Flight Verification",
      "stage": "fund",
      "level": "used-agents",
      "purpose": "configure",
      "autonomy": "live-supervised",
      "tier": "open",
      "nextPrompts": [
        "j5-first-trade-ritual"
      ],
      "whatItDoes": "Verify the kill path works before anything goes live.",
      "whyItMatters": ""
    },
    {
      "id": "b3-pre-deployment-checklist",
      "title": "Pre-Deployment Checklist",
      "stage": "fund",
      "level": "used-agents",
      "purpose": "configure",
      "autonomy": "paper",
      "tier": "open",
      "nextPrompts": [
        "b2-killswitch-pre-flight-verification"
      ],
      "whatItDoes": "Everything that must be true before an agent deploys.",
      "whyItMatters": ""
    },
    {
      "id": "b4-first-trade-dry-run-reasoner",
      "title": "First-Trade Dry-Run Reasoner",
      "stage": "rehearse",
      "level": "used-agents",
      "purpose": "operate",
      "autonomy": "paper",
      "tier": "open",
      "nextPrompts": [
        "j4-the-authorization"
      ],
      "whatItDoes": "Reason through the first trade end-to-end without placing it.",
      "whyItMatters": ""
    },
    {
      "id": "c1-sdk-setup-walkthrough",
      "title": "SDK Setup Walkthrough",
      "stage": "fund",
      "level": "built-bots",
      "purpose": "configure",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [
        "c2-sub-account-configuration-helper"
      ],
      "whatItDoes": "Set up the Gryps SDK for a coded agent.",
      "whyItMatters": ""
    },
    {
      "id": "c2-sub-account-configuration-helper",
      "title": "Sub-Account Configuration Helper",
      "stage": "fund",
      "level": "built-bots",
      "purpose": "configure",
      "autonomy": "live-supervised",
      "tier": "open",
      "nextPrompts": [
        "c3-identity-registration-helper"
      ],
      "whatItDoes": "Configure isolated capital + envelope for an agent sub-account.",
      "whyItMatters": ""
    },
    {
      "id": "c3-identity-registration-helper",
      "title": "Identity Registration Helper",
      "stage": "fund",
      "level": "built-bots",
      "purpose": "configure",
      "autonomy": "live-supervised",
      "tier": "open",
      "nextPrompts": [
        "j5-first-trade-ritual"
      ],
      "whatItDoes": "Register agent identity / session key delegation correctly.",
      "whyItMatters": ""
    },
    {
      "id": "d1-lite-prompt-injection-sentinel",
      "title": "Prompt-Injection Sentinel (Lite)",
      "stage": "operate",
      "level": "used-agents",
      "purpose": "audit",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [
        "a5-self-critique-loop"
      ],
      "whatItDoes": "Harden your agent against manipulated inputs and injected instructions.",
      "whyItMatters": ""
    },
    {
      "id": "r1-something-looks-wrong",
      "title": "Something Looks Wrong — calm triage before any action",
      "stage": "operate",
      "level": "never-used-an-agent",
      "purpose": "recover",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [
        "r2-the-dead-agent",
        "r3-emergency-flatten"
      ],
      "whatItDoes": "Read-only diagnosis: venue first, your state second, the gap third, verdict last. No orders possible.",
      "whyItMatters": "The most expensive trades in history are panic trades. Diagnosis before action, always."
    },
    {
      "id": "r2-the-dead-agent",
      "title": "The Dead Agent — unresponsive agent or expired key",
      "stage": "operate",
      "level": "never-used-an-agent",
      "purpose": "recover",
      "autonomy": "live-supervised",
      "tier": "open",
      "nextPrompts": [
        "j4-the-authorization",
        "r3-emergency-flatten"
      ],
      "whatItDoes": "Establish surviving authority, bridge urgent exposure manually, rebuild delegation through the front door.",
      "whyItMatters": "An expired key is the deadman switch working. A dead agent can't lose money — it can only leave you unwatched."
    },
    {
      "id": "r3-emergency-flatten",
      "title": "Emergency Flatten — the kill ritual, done right",
      "stage": "operate",
      "level": "never-used-an-agent",
      "purpose": "recover",
      "autonomy": "live-supervised",
      "tier": "open",
      "nextPrompts": [
        "j2-the-intake-interview"
      ],
      "whatItDoes": "Close everything reduce-only, verify flat on-chain, revoke authority, write the honest post-mortem.",
      "whyItMatters": "When you decide to stop, the job is to stop WELL. Ritual does what panic can't."
    },
    {
      "id": "s1-the-signal-stack-audit",
      "title": "The Signal Stack Audit — you connected ten sources that tell you to trade",
      "stage": "shape",
      "level": "used-agents",
      "purpose": "strategize",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [
        "j2-the-intake-interview",
        "a3-risk-envelope-reasoner",
        "d1-lite-prompt-injection-sentinel"
      ],
      "whatItDoes": "Audits the data sources feeding your agent as a decision system: true independent-input count, which sources can never clear the cost line, and the injection surface.",
      "whyItMatters": "Ten feeds produce ten reasons to act and none to sit still. The audit is what stops a well-instrumented agent from becoming a busy one."
    },
    {
      "id": "ops-1-the-daily-slipstream-watch",
      "title": "The Daily Slipstream Watch — your agent's standing morning duty",
      "stage": "operate",
      "level": "used-agents",
      "purpose": "operate",
      "autonomy": "read-only",
      "tier": "open",
      "nextPrompts": [],
      "whatItDoes": "Daily scan of the Slipstream playbook: trigger check, co-move stand-downs, edge-check on candidates, shadow log, roadmap staleness sweep.",
      "whyItMatters": "A strategy is only as real as its daily evidence. This is the shadow phase's heartbeat."
    }
  ]
}
