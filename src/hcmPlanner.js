import { CAPABILITY_KINDS, POLICY_LEVELS } from "./hcm.js";
import { answerHcmThingStateQuery } from "./hcmStateQuery.js";
import { createIntentResolution, normalizeIntentType } from "./intentResolution.js";

export function compileHcmForPlanner(home, { currentRoomId, selectedRoomId, limit = 80 } = {}) {
  if (!home?.things) return [];
  const preferredSpaces = new Set([currentRoomId, selectedRoomId].filter(Boolean));

  return home.things
    .map((thing) => compileThing(thing))
    .filter((thing) => thing.capabilities.length > 0)
    .sort((first, second) => {
      const spaceDelta = Number(preferredSpaces.has(second.roomId)) - Number(preferredSpaces.has(first.roomId));
      if (spaceDelta !== 0) return spaceDelta;
      return second.capabilities.length - first.capabilities.length;
    })
    .slice(0, limit);
}

export function normalizeHcmPlannerDraft(input, draft, home) {
  const actions = Array.isArray(draft?.actions) ? draft.actions : [];
  const normalizedActions = [];
  const rejected = [];

  for (const action of actions) {
    const result = resolvePlannerAction(action, home);
    if (!result.ok) {
      rejected.push(result.message);
      continue;
    }
    normalizedActions.push({
      thingId: result.thing.id,
      thingName: result.thing.name,
      capabilityId: result.capability.id,
      capabilityName: result.capability.name,
      value: normalizePlannerValue(action.value, result.capability),
      reason: action.reason || `${result.thing.name} ${result.capability.name}`,
      risk: result.capability.policy.risk,
      confirmation: result.capability.policy.confirmation,
      binding: result.capability.binding,
    });
  }
  const stateQuery = normalizedActions.length === 0 ? resolvePlannerStateQuery(input, draft, home, rejected) : null;
  const intentType = normalizeIntentType(draft?.intent_type, normalizedActions, stateQuery);
  const resolution = createIntentResolution({
    input,
    draft,
    intentType,
    stateQuery,
    actions: normalizedActions,
    rejected,
  });

  return {
    id: crypto.randomUUID(),
    kind: stateQuery ? "hcm_state_query" : normalizedActions.length > 0 ? "real_hcm" : "empty",
    input,
    path: "hcm-real",
    intent: typeof draft?.intent === "string" ? draft.intent : intentType,
    intentType,
    confidence: clampConfidence(draft?.confidence),
    summary:
      typeof draft?.summary === "string" && draft.summary.trim()
        ? draft.summary.trim()
        : stateQuery
          ? stateQuery.summary
        : normalizedActions.length > 0
          ? `准备执行 ${normalizedActions.length} 个真实设备动作。`
          : `没有找到可执行的真实设备动作。${rejected.join("；")}`,
    needsConfirmation:
      Boolean(draft?.needs_confirmation) ||
      normalizedActions.some((action) => ["high", "sensitive"].includes(action.risk) || action.confirmation === "always"),
    actions: normalizedActions,
    stateQuery,
    resolution,
    rejected,
    createdAt: new Date().toISOString(),
  };
}

export function buildHcmPlannerSystemPrompt() {
  return [
    "You are Harness House HCM Planner.",
    "Convert the user's Chinese smart-home instruction into strict JSON only.",
    "Use only the provided HCM devices and capability ids.",
    "Never invent devices, rooms, or capabilities.",
    "Every user command must be interpreted by you first, including read-only state questions.",
    "Prefer the user's selected/current room when the command is ambiguous.",
    "Only choose capabilities whose operation matches the user's intent.",
    "For state questions, choose exactly one HCM device in query.device_id and return no actions.",
    "For control or scene commands, choose one or more executable capabilities in actions.",
    "Read-only capabilities may only be used to answer state questions; never put read_state capabilities in actions.",
    "For on/off controls, use boolean true or false.",
    "For temperature, brightness, fan percentage, or cover position, use a number.",
    "Return exactly this JSON shape:",
    '{"intent_type":"state_query|device_control|scene|preference|unknown","intent":"string","confidence":0.0,"summary":"中文短句","needs_confirmation":false,"query":{"device_id":"thing id","reason":"中文短句"},"actions":[{"device_id":"thing id","capability":"capability id","value":true,"reason":"中文短句"}]}',
  ].join("\n");
}

function compileThing(thing) {
  const plannerCapabilities = (thing.capabilities ?? []).filter(isPlannerCapability).map((capability) => ({
    id: capability.id,
    name: capability.name,
    kind: capability.kind,
    valueType: plannerValueType(capability),
    operation: operationForCapability(capability),
    state: capability.state,
    domain: capability.binding?.domain,
    access: capability.kind === CAPABILITY_KINDS.SENSOR ? "read" : "execute",
  }));

  return {
    id: thing.id,
    name: thing.name,
    roomId: thing.spaceId,
    type: thing.type,
    aliases: thing.aliases ?? [],
    state: compactThingState(thing),
    capabilities: plannerCapabilities,
  };
}

function isPlannerCapability(capability) {
  if (isPlannerReadableCapability(capability)) return true;
  if (!capability?.policy?.autoExecutable) return false;
  if (capability.policy.risk !== POLICY_LEVELS.LOW) return false;
  if (capability.policy.confirmation !== "never") return false;
  if (![CAPABILITY_KINDS.CONTROL, CAPABILITY_KINDS.ACTION].includes(capability.kind)) return false;
  return Boolean(operationForCapability(capability));
}

function isPlannerReadableCapability(capability) {
  return capability?.kind === CAPABILITY_KINDS.SENSOR && capability.state !== undefined;
}

function operationForCapability(capability) {
  if (capability.kind === CAPABILITY_KINDS.SENSOR) return "read_state";
  const domain = capability.binding?.domain;
  if (["light", "switch", "fan", "media_player"].includes(domain)) return "on_off";
  if (domain === "climate") return "temperature_or_on_off";
  if (domain === "cover") return "position_or_open_close";
  if (domain === "button") return "press";
  return null;
}

function plannerValueType(capability) {
  const operation = operationForCapability(capability);
  if (operation === "temperature_or_on_off" || operation === "position_or_open_close") return "boolean_or_number";
  if (operation === "press") return "boolean";
  return capability.valueType || "boolean";
}

function resolvePlannerAction(action, home) {
  const thing = home.things.find((item) => item.id === action?.device_id);
  if (!thing) return { ok: false, message: `未知设备 ${action?.device_id ?? ""}` };
  const capability = thing.capabilities.find((item) => item.id === action?.capability);
  if (!capability) return { ok: false, message: `${thing.name} 不支持 ${action?.capability ?? ""}` };
  if (!isPlannerExecutableCapability(capability)) {
    return { ok: false, message: `${thing.name} ${capability.name} 不是可执行控制能力` };
  }
  return { ok: true, thing, capability };
}

function isPlannerExecutableCapability(capability) {
  if (!capability?.policy?.autoExecutable) return false;
  if (capability.policy.risk !== POLICY_LEVELS.LOW) return false;
  if (capability.policy.confirmation !== "never") return false;
  if (![CAPABILITY_KINDS.CONTROL, CAPABILITY_KINDS.ACTION].includes(capability.kind)) return false;
  return Boolean(operationForCapability(capability));
}

function normalizePlannerValue(value, capability) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  }
  if (capability.binding?.domain === "button") return true;
  return value;
}

function resolvePlannerStateQuery(input, draft, home, rejected) {
  const query = draft?.query;
  if (!query || typeof query !== "object") return null;
  const thingId = query.device_id || query.thingId;
  if (typeof thingId !== "string" || !thingId.trim()) {
    rejected.push("状态查询缺少 HCM device_id");
    return null;
  }
  const answer = answerHcmThingStateQuery(input, home, thingId, query.reason);
  if (!answer) {
    rejected.push(`状态查询目标不存在 ${thingId}`);
    return null;
  }
  return answer;
}

function compactThingState(thing) {
  const state = {};
  for (const [key, value] of Object.entries(thing.state ?? {})) {
    if (["capabilityCount"].includes(key)) continue;
    state[key] = value;
  }
  return state;
}

function clampConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}
