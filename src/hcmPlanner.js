import { CAPABILITY_KINDS, POLICY_LEVELS } from "./hcm.js";

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

  return {
    id: crypto.randomUUID(),
    kind: normalizedActions.length > 0 ? "real_hcm" : "empty",
    input,
    path: "hcm-real",
    intent: typeof draft?.intent === "string" ? draft.intent : "hcm_control",
    confidence: clampConfidence(draft?.confidence),
    summary:
      typeof draft?.summary === "string" && draft.summary.trim()
        ? draft.summary.trim()
        : normalizedActions.length > 0
          ? `准备执行 ${normalizedActions.length} 个真实设备动作。`
          : `没有找到可执行的真实设备动作。${rejected.join("；")}`,
    needsConfirmation:
      Boolean(draft?.needs_confirmation) ||
      normalizedActions.some((action) => ["high", "sensitive"].includes(action.risk) || action.confirmation === "always"),
    actions: normalizedActions,
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
    "Prefer the user's selected/current room when the command is ambiguous.",
    "Only choose capabilities whose operation matches the user's intent.",
    "For on/off controls, use boolean true or false.",
    "For temperature, brightness, fan percentage, or cover position, use a number.",
    "Return exactly this JSON shape:",
    '{"intent":"string","confidence":0.0,"summary":"中文短句","needs_confirmation":false,"actions":[{"device_id":"thing id","capability":"capability id","value":true,"reason":"中文短句"}]}',
  ].join("\n");
}

function compileThing(thing) {
  return {
    id: thing.id,
    name: thing.name,
    roomId: thing.spaceId,
    type: thing.type,
    aliases: thing.aliases ?? [],
    capabilities: (thing.capabilities ?? []).filter(isPlannerCapability).map((capability) => ({
      id: capability.id,
      name: capability.name,
      kind: capability.kind,
      valueType: plannerValueType(capability),
      operation: operationForCapability(capability),
      state: capability.state,
      domain: capability.binding?.domain,
    })),
  };
}

function isPlannerCapability(capability) {
  if (!capability?.policy?.autoExecutable) return false;
  if (capability.policy.risk !== POLICY_LEVELS.LOW) return false;
  if (capability.policy.confirmation !== "never") return false;
  if (![CAPABILITY_KINDS.CONTROL, CAPABILITY_KINDS.ACTION].includes(capability.kind)) return false;
  return Boolean(operationForCapability(capability));
}

function operationForCapability(capability) {
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
  if (!isPlannerCapability(capability)) return { ok: false, message: `${thing.name} ${capability.name} 未开放自动执行` };
  return { ok: true, thing, capability };
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

function clampConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}
