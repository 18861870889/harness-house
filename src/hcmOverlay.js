import { CAPABILITY_KINDS, POLICY_LEVELS, createHcmHome } from "./hcm.js";

export const HCM_OVERLAY_VERSION = "0.1";

export const BINDING_REVIEW_DECISIONS = {
  ALLOW_AUTO: "allow_auto",
  REQUIRE_CONFIRMATION: "require_confirmation",
  BLOCK: "block",
};

const DECISION_POLICIES = {
  [BINDING_REVIEW_DECISIONS.ALLOW_AUTO]: {
    risk: POLICY_LEVELS.LOW,
    confirmation: "never",
    autoExecutable: true,
    reason: "用户允许自动执行",
  },
  [BINDING_REVIEW_DECISIONS.REQUIRE_CONFIRMATION]: {
    risk: POLICY_LEVELS.MEDIUM,
    confirmation: "always",
    autoExecutable: false,
    reason: "用户要求执行前确认",
  },
  [BINDING_REVIEW_DECISIONS.BLOCK]: {
    risk: POLICY_LEVELS.HIGH,
    confirmation: "always",
    autoExecutable: false,
    reason: "用户禁止自动执行",
  },
};

export function createHcmOverlay({ updatedAt = new Date().toISOString(), providers = {} } = {}) {
  return {
    version: HCM_OVERLAY_VERSION,
    updatedAt: updatedAt ?? new Date().toISOString(),
    providers,
  };
}

export function setBindingReviewDecision(
  overlay,
  { providerId = "home_assistant", entityId, action, updatedAt = new Date().toISOString() } = {},
) {
  if (!entityId || typeof entityId !== "string") throw new Error("entityId is required");
  if (!DECISION_POLICIES[action]) throw new Error(`Unsupported binding review action: ${action}`);

  const next = normalizeOverlay(overlay);
  const provider = ensureProvider(next, providerId);
  provider.bindings[entityId] = {
    ...provider.bindings[entityId],
    entityId,
    decision: action,
    policy: DECISION_POLICIES[action],
    updatedAt,
  };
  next.updatedAt = updatedAt;
  return next;
}

export function applyHcmOverlay(home, overlay) {
  const normalizedOverlay = normalizeOverlay(overlay);
  const providerId = home.provider?.id ?? "unknown";
  const providerOverlay = normalizedOverlay.providers[providerId];
  if (!providerOverlay) return attachOverlayStats(home, normalizedOverlay);

  const things = home.things.map((thing) => {
    const thingOverride = providerOverlay.things[thing.id];
    const nextThing = {
      ...thing,
      ...pickThingOverride(thingOverride),
      aliases: mergeAliases(thing.aliases, thingOverride?.aliases),
      capabilities: thing.capabilities.map((capability) =>
        applyCapabilityOverride(capability, providerOverlay.bindings[capability.binding?.entityId]),
      ),
    };
    nextThing.state = {
      ...thing.state,
      autoExecutable: nextThing.capabilities.filter((capability) => capability.policy.autoExecutable).length,
      controllable: nextThing.capabilities.filter((capability) => capability.kind === CAPABILITY_KINDS.CONTROL).length,
      readable: nextThing.capabilities.filter((capability) => capability.kind === CAPABILITY_KINDS.SENSOR).length,
    };
    return nextThing;
  });

  const nextHome = createHcmHome({
    provider: home.provider,
    spaces: home.spaces,
    things,
    unresolvedBindings: buildUnresolvedBindings(things),
    syncedAt: home.syncedAt,
  });
  return attachOverlayStats(nextHome, normalizedOverlay);
}

export function summarizeOverlay(overlay) {
  const normalizedOverlay = normalizeOverlay(overlay);
  const providers = Object.values(normalizedOverlay.providers);
  let bindingOverrideCount = 0;
  const decisions = {};

  for (const provider of providers) {
    const bindings = Object.values(provider.bindings ?? {});
    bindingOverrideCount += bindings.length;
    for (const binding of bindings) {
      decisions[binding.decision] = (decisions[binding.decision] || 0) + 1;
    }
  }

  return {
    version: normalizedOverlay.version,
    updatedAt: normalizedOverlay.updatedAt,
    providerCount: providers.length,
    bindingOverrideCount,
    decisions,
  };
}

function normalizeOverlay(overlay) {
  const base = overlay && typeof overlay === "object" ? overlay : {};
  const providers = {};
  for (const [providerId, provider] of Object.entries(base.providers ?? {})) {
    providers[providerId] = {
      bindings: provider.bindings && typeof provider.bindings === "object" ? { ...provider.bindings } : {},
      things: provider.things && typeof provider.things === "object" ? { ...provider.things } : {},
    };
  }
  return createHcmOverlay({
    updatedAt: base.updatedAt,
    providers,
  });
}

function ensureProvider(overlay, providerId) {
  if (!overlay.providers[providerId]) {
    overlay.providers[providerId] = {
      bindings: {},
      things: {},
    };
  }
  return overlay.providers[providerId];
}

function applyCapabilityOverride(capability, override) {
  if (!override?.policy) return capability;
  return {
    ...capability,
    policy: {
      ...capability.policy,
      ...override.policy,
      overlayDecision: override.decision,
      overlayUpdatedAt: override.updatedAt,
    },
  };
}

function pickThingOverride(override) {
  if (!override) return {};
  const picked = {};
  if (typeof override.name === "string" && override.name.trim()) picked.name = override.name.trim();
  if (typeof override.type === "string" && override.type.trim()) picked.type = override.type.trim();
  if (typeof override.spaceId === "string" && override.spaceId.trim()) picked.spaceId = override.spaceId.trim();
  return picked;
}

function mergeAliases(current = [], extra = []) {
  return Array.from(new Set([...(Array.isArray(current) ? current : []), ...(Array.isArray(extra) ? extra : [])]));
}

function buildUnresolvedBindings(things) {
  const unresolved = [];
  const seen = new Set();
  for (const thing of things) {
    for (const capability of thing.capabilities) {
      if (!shouldReview(capability)) continue;
      const id = `${thing.id}:${capability.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      unresolved.push({
        id,
        thingId: thing.id,
        thingName: thing.name,
        thingType: thing.type,
        spaceId: thing.spaceId,
        entityId: capability.binding?.entityId,
        entityName: capability.name,
        kind: capability.kind,
        valueType: capability.valueType,
        currentState: capability.state,
        reason: capability.policy.reason,
        suggestedRisk: capability.policy.risk,
        confirmation: capability.policy.confirmation,
        autoExecutable: capability.policy.autoExecutable,
        overlayDecision: capability.policy.overlayDecision,
      });
    }
  }
  return unresolved.filter((binding) => binding.entityId);
}

function shouldReview(capability) {
  if (capability.kind === CAPABILITY_KINDS.SENSOR && capability.policy.risk === POLICY_LEVELS.LOW) return false;
  return capability.policy.risk !== POLICY_LEVELS.LOW || capability.policy.autoExecutable === false;
}

function attachOverlayStats(home, overlay) {
  return {
    ...home,
    overlay: summarizeOverlay(overlay),
  };
}
