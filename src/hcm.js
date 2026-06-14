export const HCM_VERSION = "0.1";

export const CAPABILITY_KINDS = {
  CONTROL: "control",
  SENSOR: "sensor",
  CONFIG: "config",
  ACTION: "action",
};

export const POLICY_LEVELS = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  SENSITIVE: "sensitive",
};

export function createHcmHome({
  provider,
  spaces = [],
  things = [],
  unresolvedBindings = [],
  syncedAt = new Date().toISOString(),
} = {}) {
  const normalizedSpaces = dedupeById(spaces.map(normalizeSpace));
  const normalizedThings = things.map(normalizeThing);

  return {
    version: HCM_VERSION,
    provider: provider ?? { id: "unknown", name: "Unknown Provider" },
    syncedAt,
    stats: summarizeHcm(normalizedThings, unresolvedBindings),
    review: summarizeBindingReview(unresolvedBindings),
    spaces: normalizedSpaces,
    things: normalizedThings,
    unresolvedBindings,
  };
}

export function normalizeSpace(space) {
  return {
    id: stableId(space.id || space.name || "unknown_space"),
    name: space.name || "未分区",
    aliases: Array.isArray(space.aliases) ? space.aliases : [],
    provider: space.provider ?? null,
  };
}

export function normalizeThing(thing) {
  const capabilities = Array.isArray(thing.capabilities) ? thing.capabilities.map(normalizeCapability) : [];
  return {
    id: stableId(thing.id || thing.name || "unknown_thing"),
    name: thing.name || "未命名设备",
    type: thing.type || "generic",
    spaceId: stableId(thing.spaceId || "unknown"),
    aliases: Array.isArray(thing.aliases) ? thing.aliases : [],
    online: thing.online ?? true,
    policy: normalizePolicy(thing.policy),
    provider: thing.provider ?? null,
    capabilities,
    state: thing.state ?? {},
  };
}

export function normalizeCapability(capability) {
  return {
    id: stableId(capability.id || capability.name || "capability"),
    name: capability.name || capability.id || "capability",
    kind: capability.kind || CAPABILITY_KINDS.SENSOR,
    valueType: capability.valueType || "unknown",
    state: capability.state,
    unit: capability.unit,
    policy: normalizePolicy(capability.policy),
    binding: capability.binding ?? null,
  };
}

export function normalizePolicy(policy = {}) {
  const risk = policy.risk || POLICY_LEVELS.LOW;
  return {
    risk,
    confirmation: policy.confirmation || defaultConfirmation(risk),
    autoExecutable: Boolean(policy.autoExecutable),
    reason: policy.reason || "",
  };
}

export function summarizeHcm(things, unresolvedBindings = []) {
  const spaces = new Set();
  const types = {};
  const policies = {};
  let capabilityCount = 0;
  let autoExecutableCapabilities = 0;

  for (const thing of things) {
    spaces.add(thing.spaceId);
    types[thing.type] = (types[thing.type] || 0) + 1;
    for (const capability of thing.capabilities) {
      capabilityCount += 1;
      policies[capability.policy.risk] = (policies[capability.policy.risk] || 0) + 1;
      if (capability.policy.autoExecutable) autoExecutableCapabilities += 1;
    }
  }

  return {
    thingCount: things.length,
    spaceCount: spaces.size,
    capabilityCount,
    autoExecutableCapabilities,
    unresolvedBindingCount: unresolvedBindings.length,
    types,
    policies,
  };
}

export function summarizeBindingReview(unresolvedBindings = []) {
  const byRisk = {};
  const byKind = {};
  const byReason = {};
  const byThingType = {};

  for (const binding of unresolvedBindings) {
    const risk = binding.suggestedRisk || "unknown";
    const kind = binding.kind || "unknown";
    const reason = binding.reason || "未分类";
    const thingType = binding.thingType || "generic";

    byRisk[risk] = (byRisk[risk] || 0) + 1;
    byKind[kind] = (byKind[kind] || 0) + 1;
    byReason[reason] = (byReason[reason] || 0) + 1;
    byThingType[thingType] = (byThingType[thingType] || 0) + 1;
  }

  const sortedReasons = Object.entries(byReason)
    .sort(([, first], [, second]) => second - first)
    .map(([reason, count]) => ({ reason, count }));

  return {
    total: unresolvedBindings.length,
    byRisk,
    byKind,
    byThingType,
    topReasons: sortedReasons.slice(0, 6),
    samples: unresolvedBindings.slice(0, 8),
  };
}

export function stableId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/['"()[\]{}]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    || "unknown";
}

function defaultConfirmation(risk) {
  if (risk === POLICY_LEVELS.LOW) return "never";
  if (risk === POLICY_LEVELS.MEDIUM) return "sometimes";
  return "always";
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
