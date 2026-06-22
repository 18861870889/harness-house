# Current Status

> Last updated: 2026-06-22. This document is the short source of truth for current progress, near-term plans, and safety boundaries.

## Current Version

Current engineering progress: `v0.18.1`.

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
- Policy Gate between Safety Gate and Provider Adapter simulation.
- Independent browser STT/TTS with push-to-talk, transcript confidence gating, and half-duplex output.
- Shadow home-event capture and automation suggestions with local simulation and review decisions.
- Morning Mint light UI refresh across the operational panels and Three.js digital twin.
- Stable desktop/mobile layout with distinct visual semantics for selection, occupancy, preview, execution, and alerts.
- Provider Adapter Contract and provider-neutral snapshot schema at version `1.0`.
- Capability Evidence attached to HCM capabilities.
- Simulator and Home Assistant adapters passing the same read-only Contract Harness.
- Adapter Registry and gated provider execution with simulation, authorization, and command audit identity.
- HCM Control Graph separating physical controllers, relay endpoints, logical assets, and semantic rooms.
- Logical-light planning for multi-gang switches, including strict explicit-room validation and provider-channel resolution.
- Life-view digital twin projection showing controlled lights in their semantic rooms while preserving controller identity for maintenance.
- Session-scoped conversation target memory with deterministic referential-command protection.
- Inventory/count/list queries over HCM logical devices.
- Atomic numbered-device group expansion and residual-member correction.
- Primary relay vs remote-binding classification in the Control Graph.
- Provider state readback after execution; service acceptance alone is not final success.

`v0.10 Real Home Pilot` is intentionally not marked complete. It requires real-home observation over time and user-authorized low-risk device testing.

## v0.16.1 UI Refresh

Status: completed.

- Replaced the dark glass theme with warm white, mint, neutral wood, amber, and coral semantic colors.
- Preserved the existing three-surface information architecture and all command, speech, agent, automation, mapping, and audit controls.
- Updated Three.js room floors, translucent walls, furniture, labels, lighting, fog, and grid for the light environment.
- Kept selection, occupancy, preview, execution, and alert as independent digital-twin layers.
- Stabilized Command panel sizing so the input does not overlap the following panel.
- Verified desktop and 390px mobile layouts without horizontal overflow.

## v0.17 Adapter SDK & Provider Portability

Status: completed for the SDK and current-provider migration scope.

- Added the required Adapter methods: identity, connection status, snapshot discovery, HCM mapping, action compilation, simulation, execution, and state reading.
- Added provider-neutral snapshots and diffs for stable device/entity/state change detection.
- Added Capability Evidence with observed provider facts, command candidates, constraints, and confidence.
- Migrated Simulator and Home Assistant to Contract `1.0` while retaining the discovery methods used by the current UI/runtime.
- Added a reusable adapter template, registry, fixture-driven Contract Harness, and failure injection tests.
- Provider execution now requires runtime authorization, successful adapter simulation bound to the same command fingerprint, and a command ID.
- Disabled the public direct Home Assistant action route; commands must enter through `/api/hcm/command`.

Limit: Matter/MQTT adapters are not claimed as hardware-certified until corresponding devices or certified fixtures are available. The SDK contract and mock portability path are complete.

## v0.18A Multi-Gang Switch Control Graph

Status: implemented and verified against the current read-only HA snapshot.

- Derives `Controller -> Endpoint -> Asset -> Space` without changing HA entities or provider data.
- Current snapshot produces 22 physical panels, 56 relay endpoints, and 41 logical controlled assets.
- `入户1号开关` is resolved as two independent endpoints: left -> `餐厅射灯`, right -> `餐边柜灯带`.
- Unnamed channels and remote bindings remain review/unbound and are not exposed as primary actuators.
- Planner targets logical assets and normalization resolves back to the original HCM thing/capability.
- Explicit room mismatch is rejected for logical assets instead of relying on model similarity.
- Relay state is labeled inferred; actual light output remains unknown without independent observation.
- Mapping corrections persist in HCM Overlay through `POST /api/hcm/overrides/control-mappings`.
- Digital-twin preview/execution targets logical asset IDs.

## v0.18.1 Intent And Control Closed Loop

Status: implemented and validated with the real HA snapshot using read-only queries and dry-run commands.

- A failed control request can no longer degrade into an `answered` state query.
- `关一下` and similar follow-ups use the previous audited target; mismatches are blocked as critical.
- Numbered logical groups execute atomically; unresolved members prevent silent partial execution.
- Corrective language such as `还有一个没关` selects only members whose relay state still differs from the requested state.
- Inventory questions such as `客厅有几个射灯` return deterministic counts and names.
- Explicit load-room semantics override the physical controller's HA Area.
- Remote bindings remain review relationships and cannot replace the primary direct relay.
- Successful execution now requires provider state convergence.

Design: [INTENT_CONTROL_CLOSED_LOOP.md](INTENT_CONTROL_CLOSED_LOOP.md).

## Current Runtime Chain

```text
User Command
  -> Conversation Context
  -> Context Snapshot
  -> HCM Overlay + Personal Semantics
  -> HCM Control Graph
  -> Context Agent Snapshot
  -> Prompt Compile
  -> LLM Planner
  -> Plan Normalize
  -> Intent Accuracy Engine
  -> Safety Gate
  -> Policy Gate
  -> Provider Adapter Compile / Simulate
  -> Authorized Provider Execute
  -> Provider State Readback
  -> Audit / Learning / Agents
```

Key boundaries:

- LLM understands intent; it does not own service selection or final execution permission.
- HCM is the upper-layer model; provider entities must not leak directly into planner/runtime code.
- Safety Gate answers whether a capability is executable.
- Policy Gate answers whether this context should execute it.
- The active Provider Adapter validates its command against current HCM evidence before any real device call; HA currently reuses the strict HA Service Simulator internally.

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

Status: completed for the alpha scope.

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

Status: completed for the shadow proposal scope.

Product meaning: the house starts noticing repeatable situations and proposes automations, but it does not silently take control.

Example:

```text
Observed: study presence becomes occupied after 20:00, and the study light is usually turned on within 30 seconds.
Proposal: when the study becomes occupied after 20:00, turn on the study light.
Result: show the proposal, simulate it, and wait for user review.
```

Implemented scope:

Scope:

- Read-only HCM snapshot capture and state-change event history.
- Suggestions from at least two matching successful audited actions.
- Preview-only simulations through HCM Executor, Policy Gate, and HA Service Simulator.
- Local `reviewed` / `ignored` decisions; no persistent provider automation is created.

This version does not automatically write Home Assistant automations or execute a newly discovered rule.

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
- Real-device execution requires user authorization and must go through HCM, Intent Accuracy Engine, Safety Gate, Policy Gate, and the active Provider Adapter simulation.
- High-risk, privacy, gas/water heater, lock, config, and unclear capabilities default to protected.
- Learning and multi-agent suggestions remain shadow-mode unless explicitly reviewed.
