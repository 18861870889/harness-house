# Current Status

> Last updated: 2026-06-18. This document is the short source of truth for current progress, near-term plans, and safety boundaries.

## Current Version

Current engineering progress: `v0.14`.

Completed major runtime capabilities:

- Local 3D MVP with simulator devices and Three.js house view.
- OpenAI-compatible LLM planning, currently usable with DeepSeek-style providers.
- Home Assistant discovery and HCM mapping.
- HCM overlay and review decisions.
- Production command pipeline with audit, replay, learning memory, and explanations.
- HA service simulator for dry-run validation before real execution.
- Shadow multi-agent runtime: Context, Learning, Mapping, Diagnostics, Test.
- Provider-to-HCM onboarding planner for new/changed/deleted provider devices.
- Intent Accuracy Engine after LLM output.
- Digital Twin State Layers for `selection / occupancy / preview / execution / alert`.
- Policy Gate between Safety Gate and HA Service Simulator.

`v0.10 Real Home Pilot` is intentionally not marked complete. It requires real-home observation over time and user-authorized low-risk device testing.

## Current Runtime Chain

```text
User Command
  -> Context Snapshot
  -> HCM Overlay + Personal Semantics
  -> Context Agent Snapshot
  -> Prompt Compile
  -> LLM Planner
  -> Plan Normalize
  -> Intent Accuracy Engine
  -> Safety Gate
  -> Policy Gate
  -> HA Service Simulator
  -> Device Executor
  -> Audit / Learning / Agents
```

Key boundaries:

- LLM understands intent; it does not own service selection or final execution permission.
- HCM is the upper-layer model; provider entities must not leak directly into planner/runtime code.
- Safety Gate answers whether a capability is executable.
- Policy Gate answers whether this context should execute it.
- HA Service Simulator validates provider service support before any real device call.

## Near-Term Plan

### v0.10 - Real Home Pilot

Goal: run a limited real-home pilot with low-risk devices only.

Scope:

- Lights, fan, curtains, TV/media pause/stop, bounded climate temperature.
- Dry-run and audit for all experiments.
- Manual authorization for any real-device execution during testing.

Exit criteria:

- 7-day stable observation.
- Common command P95 around 2 seconds.
- UI state and HA state consistency above 98% for pilot devices.
- 0 high-risk accidental executions.
- All failures have audit traces.

### v0.15 - Independent STT & TTS Alpha

Goal: provide independent push-to-talk speech input and reliable speech output without Xiaoai integration.

Scope:

- Add a `SpeechInput` abstraction: microphone audio -> STT transcript -> visible command text.
- Submit STT transcripts through the existing `/api/hcm/command` pipeline; STT never calls devices directly.
- Use push-to-talk and half-duplex interaction by default: pause listening while TTS is speaking.
- Require review or retry when STT confidence is low, the transcript is empty, or audio is truncated.
- Speak state-query answers, execution results, rejections, and confirmation requests.
- Keep text as the source of truth; TTS consumes the final audited response and cannot create another command.
- Provide replaceable `SpeechInput` and `SpeechOutput` provider abstractions.
- Support mute, volume, interruption, duplicate suppression, and long-text truncation.

Non-goals:

- Xiaoai integration.
- Always-listening voice assistant.
- Wake-word detection.
- Voice commands that bypass transcript visibility or the HCM command pipeline.

### v0.16 - Home Event & Automation Suggestions

Product meaning: the house starts noticing repeatable situations and proposes automations, but it does not silently take control.

Example:

```text
Observed: study presence becomes occupied after 20:00, and the study light is usually turned on within 30 seconds.
Proposal: when the study becomes occupied after 20:00, turn on the study light.
Result: show the proposal, simulate it, and wait for user review.
```

Goal: move beyond manual commands while keeping event-driven automation suggestions in shadow mode first.

Scope:

- Event ingestion from HA state changes / provider snapshots.
- Rule proposal generation from audit and sensor patterns.
- Preview-only automation simulations.
- User review before any persistent automation.

This version does not automatically write Home Assistant automations or execute a newly discovered rule.

### v0.17 - Adapter SDK & Provider Portability

Product meaning: changing the device host should not require rebuilding Harness House.

Example:

```text
Today: Home Assistant entity -> HA Adapter -> HCM light capability
Later: Matter device -> Matter Adapter -> the same HCM light capability
```

The planner, safety rules, policy gate, audit, and 3D UI continue to use HCM and do not know which provider is underneath.

Goal: make Home Assistant replaceable as one provider among many.

Scope:

- Adapter contract test harness.
- Provider snapshot/diff fixtures.
- Capability evidence requirements.
- Example simulator/provider adapter templates.
- A semi-automatic onboarding path for unmapped capabilities instead of hard-coding each new device type.

### v1.0 - Open Source Framework Release

Goal: stable local-first AI smart-home framework release.

Required:

- HCM contract and adapter docs.
- Simulator Adapter.
- Home Assistant Adapter.
- Capability registry and policy gates.
- LLM planner and intent accuracy checks.
- Audit/replay/learning.
- Digital twin UI.
- Safety and testing documentation.

## Verification Commands

```bash
npm test
npm run build
git diff --check
```

Browser smoke checks should verify:

- App renders without console errors.
- 3D canvas is present and non-empty.
- Main panels render.
- HCM mode works when HA is configured; simulator fallback works otherwise.

## Safety Rules

- Automated tests must not call real HA `/api/services/*`.
- Real-device execution requires user authorization and must go through HCM, Intent Accuracy Engine, Safety Gate, Policy Gate, and HA Service Simulator.
- High-risk, privacy, gas/water heater, lock, config, and unclear capabilities default to protected.
- Learning and multi-agent suggestions remain shadow-mode unless explicitly reviewed.
