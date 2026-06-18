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

### v0.15 - Voice Interaction Alpha

Goal: add voice input/output without weakening runtime safety.

Likely path:

- Treat voice as another command source: `source=voice`.
- Reuse HCM command pipeline, Intent Accuracy Engine, Safety Gate, Policy Gate, and audit.
- Start with push-to-talk or local browser microphone experiments.
- Evaluate whether Xiaoai speaker can be used as I/O; if not, use an independent STT/TTS module.

Non-goals:

- Always-listening production voice assistant.
- Voice-based high-risk execution.
- Vendor-specific hacks that bypass HCM.

### v0.16 - Event Runtime & Automation Proposals

Goal: move beyond manual commands while keeping automation suggestions in shadow mode first.

Scope:

- Event ingestion from HA state changes / provider snapshots.
- Rule proposal generation from audit and sensor patterns.
- Preview-only automation simulations.
- User review before any persistent automation.

### v0.17 - Adapter SDK & Provider Portability

Goal: make Home Assistant replaceable as one provider among many.

Scope:

- Adapter contract test harness.
- Provider snapshot/diff fixtures.
- Capability evidence requirements.
- Example simulator/provider adapter templates.

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
