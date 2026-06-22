import { CAPABILITY_KINDS, POLICY_LEVELS } from "./hcm.js";
import { answerHcmThingStateQuery, looksLikeStateQuery } from "./hcmStateQuery.js";
import { answerHcmInventoryQuery, looksLikeInventoryQuery } from "./hcmKnowledgeQuery.js";
import { isReferentialControlInput } from "./conversationContext.js";
import { createIntentResolution, normalizeIntentType } from "./intentResolution.js";
import { findExplicitRoomIds, getHcmControlGraph, resolveControlAsset } from "./hcmControlGraph.js";

const CONTROL_REQUEST_PATTERN = /打开|开启|启动|关闭|关掉|停止|暂停|调到|设置|播放|清扫|没关|忘了关|还开着/;

export function compileHcmForPlanner(home, { input = "", currentRoomId, selectedRoomId, focusTargetIds = [], limit = 80 } = {}) {
  if (!home?.things) return [];
  const preferredSpaces = new Set([currentRoomId, selectedRoomId].filter(Boolean));
  const focusedTargets = new Set(focusTargetIds);
  const explicitSpaces = new Set(findExplicitRoomIds(input, home));
  const graph = getHcmControlGraph(home);
  const mappedEntityIds = new Set(graph.endpoints.map((endpoint) => endpoint.entityId));

  const physicalThings = home.things
    .map((thing) =>
      compileThing(
        thing,
        thing.type === "switch_panel"
          ? (capability) => capability.binding?.domain === "light" && !mappedEntityIds.has(capability.binding?.entityId)
          : () => true,
      ),
    );
  const logicalAssets = compileControlAssets(home);

  let candidates = [...logicalAssets, ...physicalThings].filter((thing) => thing.capabilities.length > 0);
  if (explicitSpaces.size > 0) {
    candidates = candidates.filter((thing) => explicitSpaces.has(thing.roomId) || focusedTargets.has(thing.id));
  } else if (focusedTargets.size > 0 && isReferentialControlInput(input)) {
    candidates = candidates.filter((thing) => focusedTargets.has(thing.id));
  }

  return candidates
    .sort((first, second) => {
      const focusDelta = Number(focusedTargets.has(second.id)) - Number(focusedTargets.has(first.id));
      if (focusDelta !== 0) return focusDelta;
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
  const requestedIntentType = normalizeIntentType(draft?.intent_type, [], null);
  const controlRequested = CONTROL_REQUEST_PATTERN.test(input) || ["device_control", "scene"].includes(requestedIntentType);

  for (const action of actions) {
    const result = resolvePlannerAction(input, action, home);
    if (!result.ok) {
      rejected.push(result.message);
      continue;
    }
    normalizedActions.push(toNormalizedAction(result, action));
  }
  if (normalizedActions.length === 0 && controlRequested) {
    normalizedActions.push(...resolveResidualGroupActions(input, home));
  }
  const groupResolution = expandNumberedAssetGroup(input, normalizedActions, home);
  const resolvedActions = groupResolution.blocked ? [] : groupResolution.actions;
  if (groupResolution.blocked) rejected.push(...groupResolution.unresolved.map((item) => `${item.name} 没有已确认的可执行控制通道`));
  const inventoryQuery = resolvedActions.length === 0 && !controlRequested && looksLikeInventoryQuery(input)
    ? answerHcmInventoryQuery(input, home, draft?.query?.reason)
    : null;
  const stateQuery = resolvedActions.length === 0 && !controlRequested && !inventoryQuery && requestedIntentType === "state_query" && looksLikeStateQuery(input)
    ? resolvePlannerStateQuery(input, draft, home, rejected)
    : inventoryQuery;
  const intentType = inventoryQuery
    ? "inventory_query"
    : controlRequested
      ? requestedIntentType === "scene" || resolvedActions.length > 1 ? "scene" : "device_control"
      : normalizeIntentType(draft?.intent_type, resolvedActions, stateQuery);
  const unresolvedControl = controlRequested && resolvedActions.length === 0 && !groupResolution.satisfied;
  const resolution = createIntentResolution({
    input,
    draft,
    intentType,
    stateQuery,
    actions: resolvedActions,
    rejected,
  });

  return {
    id: crypto.randomUUID(),
    kind: inventoryQuery
      ? "hcm_inventory_query"
      : stateQuery
        ? "hcm_state_query"
        : unresolvedControl
          ? "unresolved_control"
          : resolvedActions.length > 0
            ? "real_hcm"
            : "empty",
    input,
    path: "hcm-real",
    intent: typeof draft?.intent === "string" ? draft.intent : intentType,
    intentType,
    confidence: clampConfidence(draft?.confidence),
    summary:
      stateQuery
        ? stateQuery.summary
        : typeof draft?.summary === "string" && draft.summary.trim()
          ? draft.summary.trim()
        : groupResolution.satisfied
          ? "目标集合已经处于期望状态，无需执行设备动作。"
        : resolvedActions.length > 0
          ? `准备执行 ${resolvedActions.length} 个真实设备动作。`
          : `没有找到可执行的真实设备动作。${rejected.join("；")}`,
    needsConfirmation:
      Boolean(draft?.needs_confirmation) ||
      unresolvedControl ||
      resolvedActions.some((action) => ["high", "sensitive"].includes(action.risk) || action.confirmation === "always"),
    requiresClarification: unresolvedControl,
    actions: resolvedActions,
    stateQuery,
    groupResolution,
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
    "Use personal_semantics as hints for household phrases, but still output only valid HCM device ids and capability ids.",
    "Use conversation.focused_targets as the primary referent for short follow-ups such as 关一下, 打开它, or 也打开. Never replace that referent with the selected room.",
    "Prefer the user's selected/current room when the command is ambiguous.",
    "roomId is the semantic location of the controlled object, not necessarily the physical controller location.",
    "When the user explicitly names a room, only choose devices with that exact roomId.",
    "A logical light may be backed by a multi-gang wall switch; target the logical light device, never guess a switch panel.",
    "Only choose capabilities whose operation matches the user's intent.",
    "For state questions, choose exactly one HCM device in query.device_id and set query.mode to state.",
    "For inventory/count/list questions, set intent_type to inventory_query, query.mode to count or list, and return no actions.",
    "For control or scene commands, choose one or more executable capabilities in actions.",
    "Read-only capabilities may only be used to answer state questions; never put read_state capabilities in actions.",
    "For on/off controls, use boolean true or false.",
    "For temperature, brightness, fan percentage, or cover position, use a number.",
    "Return exactly this JSON shape:",
    '{"intent_type":"state_query|inventory_query|device_control|scene|preference|unknown","intent":"string","confidence":0.0,"summary":"中文短句","needs_confirmation":false,"query":{"mode":"state|count|list","device_id":"thing id or empty","reason":"中文短句"},"actions":[{"device_id":"thing id","capability":"capability id","value":true,"reason":"中文短句"}]}',
  ].join("\n");
}

function compileThing(thing, includeCapability = () => true) {
  const plannerCapabilities = (thing.capabilities ?? []).filter(includeCapability).filter(isPlannerCapability).map((capability) => ({
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

function compileControlAssets(home) {
  const graph = getHcmControlGraph(home);
  return graph.assets
    .map((asset) => {
      const resolved = resolveControlAsset(home, asset.id);
      const capability = resolved?.capability;
      const executable = capability && isPlannerExecutableCapability(capability);
      const capabilities = [];
      if (executable) {
        capabilities.push({
          id: "power",
          name: `${asset.name}开关`,
          kind: CAPABILITY_KINDS.CONTROL,
          valueType: "boolean",
          operation: "on_off",
          state: asset.state?.commandedState,
          domain: capability.binding?.domain,
          access: "execute",
        });
      }
      if (!executable && asset.state?.commandedState !== "unknown") {
        capabilities.push({
          id: "power_state",
          name: `${asset.name}回路状态`,
          kind: CAPABILITY_KINDS.SENSOR,
          valueType: "boolean",
          operation: "read_state",
          state: asset.state.commandedState,
          domain: capability?.binding?.domain,
          access: "read",
        });
      }
      return {
        id: asset.id,
        name: asset.name,
        roomId: asset.spaceId,
        type: asset.type,
        aliases: asset.aliases ?? [],
        logicalAsset: true,
        mappingStatus: asset.mappingStatus,
        mappingConfidence: asset.mappingConfidence,
        state: asset.state,
        capabilities,
      };
    })
    .filter((asset) => asset.capabilities.length > 0);
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

function resolvePlannerAction(input, action, home) {
  const logical = resolveControlAsset(home, action?.device_id);
  if (logical?.asset) {
    if (action?.capability !== "power") {
      return { ok: false, message: `${logical.asset.name} 不支持 ${action?.capability ?? ""}` };
    }
    const explicitRoomIds = findExplicitRoomIds(input, home);
    if (explicitRoomIds.length > 0 && !explicitRoomIds.includes(logical.asset.spaceId)) {
      return { ok: false, message: `${logical.asset.name} 不在用户指定的房间` };
    }
    if (!logical.endpoint || !logical.thing || !logical.capability) {
      return { ok: false, message: `${logical.asset.name} 没有已确认的可执行控制通道` };
    }
    if (!isPlannerExecutableCapability(logical.capability)) {
      return { ok: false, message: `${logical.asset.name} 的控制通道不是可自动执行能力` };
    }
    return {
      ok: true,
      logicalAsset: logical.asset,
      endpoint: logical.endpoint,
      thing: logical.thing,
      capability: logical.capability,
    };
  }
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

function resolveResidualGroupActions(input, home) {
  if (!(/还有|另一个|剩下/.test(input) && /没关|还开着|未关闭/.test(input))) return [];
  const graph = getHcmControlGraph(home);
  const groups = new Map();
  for (const asset of graph.assets) {
    const stem = numberedStem(asset.name);
    if (!stem || !String(input).includes(stem)) continue;
    const key = `${asset.spaceId}:${stem}`;
    const group = groups.get(key) ?? [];
    group.push(asset);
    groups.set(key, group);
  }
  const actions = [];
  for (const assets of groups.values()) {
    if (assets.length < 2) continue;
    for (const asset of assets.filter((item) => item.state?.commandedState !== false)) {
      const result = resolvePlannerAction(input, { device_id: asset.id, capability: "power", value: false }, home);
      if (result.ok) actions.push(toNormalizedAction(result, { value: false, reason: "根据当前回路状态关闭剩余开启成员" }));
    }
  }
  return dedupeActions(actions);
}

function toNormalizedAction(result, action) {
  return {
    thingId: result.thing.id,
    thingName: result.logicalAsset?.name ?? result.thing.name,
    providerThingName: result.logicalAsset ? result.thing.name : undefined,
    logicalAssetId: result.logicalAsset?.id,
    logicalAssetName: result.logicalAsset?.name,
    logicalRoomId: result.logicalAsset?.spaceId,
    capabilityId: result.capability.id,
    capabilityName: result.logicalAsset ? `${result.logicalAsset.name}开关` : result.capability.name,
    value: normalizePlannerValue(action.value, result.capability),
    reason: action.reason || `${result.thing.name} ${result.capability.name}`,
    risk: result.capability.policy.risk,
    confirmation: result.capability.policy.confirmation,
    binding: result.capability.binding,
  };
}

function expandNumberedAssetGroup(input, actions, home) {
  const graph = getHcmControlGraph(home);
  let expanded = [...actions];
  const unresolved = [];
  const groups = [];
  const processed = new Set();
  let satisfied = false;

  for (const action of actions) {
    if (!action.logicalAssetId || typeof action.value !== "boolean") continue;
    const stem = numberedStem(action.logicalAssetName);
    if (!stem || !String(input).includes(stem) || String(input).includes(action.logicalAssetName)) continue;
    const siblings = graph.assets.filter((asset) => asset.spaceId === action.logicalRoomId && numberedStem(asset.name) === stem);
    if (siblings.length < 2) continue;
    const groupKey = `${action.logicalRoomId}:${stem}:${action.value}`;
    if (processed.has(groupKey)) continue;
    processed.add(groupKey);
    const residualOnly = /还有|另一个|剩下/.test(input) && /没关|还开着|未关闭/.test(input) && action.value === false;
    const targets = residualOnly
      ? siblings.filter((asset) => asset.state?.commandedState !== action.value)
      : siblings;
    if (residualOnly) {
      expanded = expanded.filter((item) => !siblings.some((sibling) => sibling.id === item.logicalAssetId));
      satisfied = targets.length === 0;
    }
    groups.push({ stem, assetIds: siblings.map((asset) => asset.id), targetAssetIds: targets.map((asset) => asset.id), residualOnly });
    for (const sibling of targets) {
      if (expanded.some((item) => item.logicalAssetId === sibling.id)) continue;
      const result = resolvePlannerAction(input, { device_id: sibling.id, capability: "power", value: action.value }, home);
      if (!result.ok) {
        unresolved.push({ id: sibling.id, name: sibling.name, reason: result.message });
        continue;
      }
      expanded.push({
        thingId: result.thing.id,
        thingName: sibling.name,
        providerThingName: result.thing.name,
        logicalAssetId: sibling.id,
        logicalAssetName: sibling.name,
        logicalRoomId: sibling.spaceId,
        capabilityId: result.capability.id,
        capabilityName: `${sibling.name}开关`,
        value: action.value,
        reason: `集合指令 ${stem}`,
        risk: result.capability.policy.risk,
        confirmation: result.capability.policy.confirmation,
        binding: result.capability.binding,
      });
    }
  }

  return {
    mode: groups.length > 0 ? "numbered_group" : "single",
    groups,
    actions: dedupeActions(expanded),
    unresolved,
    blocked: unresolved.length > 0,
    satisfied,
  };
}

function numberedStem(name) {
  const text = String(name ?? "").trim();
  const stem = text.replace(/[0-9一二三四五六七八九十]+$/, "");
  return stem !== text && stem.length >= 2 ? stem : null;
}

function dedupeActions(actions) {
  const seen = new Set();
  return actions.filter((action) => {
    const key = `${action.thingId}:${action.capabilityId}:${action.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
