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

const DEFAULT_DECISION_POLICIES = {
  [BINDING_REVIEW_DECISIONS.ALLOW_AUTO]: {
    ...DECISION_POLICIES[BINDING_REVIEW_DECISIONS.ALLOW_AUTO],
    reason: "默认开放可执行能力",
  },
  [BINDING_REVIEW_DECISIONS.BLOCK]: {
    ...DECISION_POLICIES[BINDING_REVIEW_DECISIONS.BLOCK],
    reason: "默认保护高风险/配置能力",
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

export function setThingOverride(
  overlay,
  { providerId = "home_assistant", thingId, patch = {}, updatedAt = new Date().toISOString() } = {},
) {
  if (!thingId || typeof thingId !== "string") throw new Error("thingId is required");
  const next = normalizeOverlay(overlay);
  const provider = ensureProvider(next, providerId);
  provider.things[thingId] = {
    ...provider.things[thingId],
    ...pickThingOverride(patch),
    disabled: typeof patch.disabled === "boolean" ? patch.disabled : provider.things[thingId]?.disabled,
    aliases: mergeAliases(provider.things[thingId]?.aliases, patch.aliases),
    updatedAt,
  };
  next.updatedAt = updatedAt;
  return next;
}

export function applyDefaultRunPolicy(
  overlay,
  home,
  { providerId = home?.provider?.id ?? "home_assistant", updatedAt = new Date().toISOString() } = {},
) {
  const next = normalizeOverlay(overlay);
  const provider = ensureProvider(next, providerId);
  const summary = {
    total: 0,
    allowed: 0,
    protected: 0,
    skippedExisting: 0,
  };

  for (const binding of home?.unresolvedBindings ?? []) {
    if (!binding.entityId) continue;
    summary.total += 1;
    if (provider.bindings[binding.entityId]?.decision) {
      summary.skippedExisting += 1;
      continue;
    }

    const decision = recommendDefaultDecision(binding);
    provider.bindings[binding.entityId] = {
      ...provider.bindings[binding.entityId],
      entityId: binding.entityId,
      decision,
      policy: DECISION_POLICIES[decision],
      updatedAt,
    };
    if (decision === BINDING_REVIEW_DECISIONS.ALLOW_AUTO) summary.allowed += 1;
    else summary.protected += 1;
  }

  next.updatedAt = updatedAt;
  return { overlay: next, summary };
}

export function applyHcmOverlay(home, overlay, { defaultRunPolicy = true } = {}) {
  const normalizedOverlay = normalizeOverlay(overlay);
  const providerId = home.provider?.id ?? "unknown";
  const providerOverlay = normalizedOverlay.providers[providerId] ?? { bindings: {}, things: {} };
  const unresolvedByEntity = new Map(home.unresolvedBindings.map((binding) => [binding.entityId, binding]));
  const defaultPolicy = {
    enabled: defaultRunPolicy,
    total: home.unresolvedBindings.length,
    allowed: 0,
    protected: 0,
  };

  const things = home.things
    .filter((thing) => providerOverlay.things[thing.id]?.disabled !== true)
    .map((thing) => {
      const thingOverride = providerOverlay.things[thing.id];
      const nextThing = {
        ...thing,
        ...pickThingOverride(thingOverride),
        aliases: mergeAliases(thing.aliases, thingOverride?.aliases),
        capabilities: thing.capabilities.map((capability) => {
          const binding = unresolvedByEntity.get(capability.binding?.entityId);
          return applyCapabilityOverride(
            capability,
            binding,
            providerOverlay.bindings[capability.binding?.entityId],
            defaultRunPolicy ? createDefaultOverride(binding, defaultPolicy) : null,
          );
        }),
      };
      nextThing.state = {
        ...thing.state,
        autoExecutable: nextThing.capabilities.filter((capability) => isExecutableCapability(capability)).length,
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
  return attachOverlayStats(nextHome, normalizedOverlay, defaultPolicy);
}

export function recommendDefaultDecision(binding) {
  if (requiresHardProtection(binding)) return BINDING_REVIEW_DECISIONS.BLOCK;
  return BINDING_REVIEW_DECISIONS.ALLOW_AUTO;
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
    disabledThingCount: providers.reduce(
      (sum, provider) => sum + Object.values(provider.things ?? {}).filter((thing) => thing.disabled).length,
      0,
    ),
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

function applyCapabilityOverride(capability, binding, override, defaultOverride) {
  const selectedOverride = selectEffectiveOverride(binding, override, defaultOverride);
  if (!selectedOverride?.policy) return capability;
  return {
    ...capability,
    policy: {
      ...capability.policy,
      ...selectedOverride.policy,
      overlayDecision: selectedOverride.decision,
      overlayUpdatedAt: selectedOverride.updatedAt,
      overlaySource: selectedOverride.source,
    },
  };
}

function selectEffectiveOverride(binding, override, defaultOverride) {
  if (
    binding &&
    override?.decision === BINDING_REVIEW_DECISIONS.ALLOW_AUTO &&
    requiresHardProtection(binding)
  ) {
    return {
      entityId: binding.entityId,
      decision: `default_${BINDING_REVIEW_DECISIONS.BLOCK}`,
      policy: DEFAULT_DECISION_POLICIES[BINDING_REVIEW_DECISIONS.BLOCK],
      source: "hard_protection",
    };
  }
  return override?.policy ? override : defaultOverride;
}

function createDefaultOverride(binding, summary) {
  if (!binding?.entityId) return null;
  const decision = recommendDefaultDecision(binding);
  if (decision === BINDING_REVIEW_DECISIONS.ALLOW_AUTO) summary.allowed += 1;
  else summary.protected += 1;
  return {
    entityId: binding.entityId,
    decision: `default_${decision}`,
    policy: DEFAULT_DECISION_POLICIES[decision],
    source: "default_run_policy",
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

function isExecutableCapability(capability) {
  return capability.policy.autoExecutable && (
    capability.kind === CAPABILITY_KINDS.CONTROL ||
    capability.kind === CAPABILITY_KINDS.ACTION
  );
}

function requiresHardProtection(binding) {
  const text = `${binding.thingName ?? ""} ${binding.entityName ?? ""} ${binding.reason ?? ""} ${binding.thingType ?? ""}`
    .toLowerCase();
  if (binding.suggestedRisk === POLICY_LEVELS.SENSITIVE) return true;
  if (binding.kind === CAPABILITY_KINDS.SENSOR) return true;
  if (binding.kind === CAPABILITY_KINDS.CONFIG) return true;
  if (binding.valueType === "text") return true;
  return /密码|password|燃气|gas|热水器|摄像|监控|camera|配置|config|互控|解控|绑定|物理控制锁|童锁/.test(text);
}

function attachOverlayStats(home, overlay, defaultPolicy = null) {
  return {
    ...home,
    overlay: summarizeOverlay(overlay),
    defaultPolicy,
  };
}
