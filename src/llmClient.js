import { commandStep, createPlan } from "./simulator.js";

const ALLOWED_CAPABILITIES = new Set([
  "turn_on",
  "turn_off",
  "set_brightness",
  "set_temperature",
  "set_speed",
  "set_position",
  "start_robot",
  "dock_robot",
  "start_cycle",
  "stop_cycle",
  "dispense_food",
]);

export async function getLlmStatus() {
  try {
    const response = await fetch("/api/llm/status");
    if (!response.ok) throw new Error(`status ${response.status}`);
    return response.json();
  } catch (error) {
    return {
      configured: false,
      mode: "simulated",
      error: error.message,
    };
  }
}

export async function requestLlmPlan({ input, devices, currentRoomId, selectedRoomId, timeoutMs = 1500 }) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("/api/llm/plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input,
        currentRoomId,
        selectedRoomId,
        devices: summarizeDevicesForLlm(devices),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `LLM request failed: ${response.status}`);
    }

    const data = await response.json();
    return normalizeLlmDraft(input, data, devices);
  } finally {
    window.clearTimeout(timer);
  }
}

function summarizeDevicesForLlm(devices) {
  return Object.values(devices).map((device) => ({
    id: device.id,
    name: device.name,
    roomId: device.roomId,
    type: device.type,
    risk: device.risk,
    state: pickState(device),
  }));
}

function pickState(device) {
  const state = {};
  for (const key of [
    "on",
    "brightness",
    "temperature",
    "mode",
    "speed",
    "position",
    "detected",
    "open",
    "status",
    "battery",
    "portionsToday",
    "lastFeed",
    "privacyMode",
    "minutesLeft",
  ]) {
    if (key in device) state[key] = device[key];
  }
  return state;
}

function normalizeLlmDraft(input, draft, devices) {
  const actions = Array.isArray(draft.actions) ? draft.actions : [];
  const steps = [];
  const rejected = [];

  for (const action of actions) {
    const device = devices[action.device_id];
    const capability = action.capability;
    if (!device) {
      rejected.push(`unknown device: ${action.device_id}`);
      continue;
    }
    if (!ALLOWED_CAPABILITIES.has(capability)) {
      rejected.push(`unsupported capability: ${capability}`);
      continue;
    }
    steps.push(
      commandStep(
        device,
        capability,
        normalizeValue(action.value),
        action.reason || `LLM requested ${capability} for ${device.name}`,
      ),
    );
  }

  const needsConfirmation =
    Boolean(draft.needs_confirmation) ||
    steps.some((step) => ["high", "sensitive"].includes(step.risk));

  return createPlan({
    input,
    path: "llm-real",
    intent: draft.intent || "llm_control",
    confidence: clampConfidence(draft.confidence),
    needsConfirmation,
    steps,
    summary:
      draft.summary ||
      (steps.length > 0
        ? `真实大模型生成了 ${steps.length} 个设备动作。`
        : `真实大模型没有生成可执行动作。${rejected.join("；")}`),
  });
}

function normalizeValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }
  return value;
}

function clampConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.6;
  return Math.max(0, Math.min(1, value));
}
