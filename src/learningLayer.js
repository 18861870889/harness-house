export const LEARNING_MEMORY_VERSION = "0.1";

export function createLearningMemory({ updatedAt = new Date().toISOString(), candidates = [], observations = [] } = {}) {
  return {
    version: LEARNING_MEMORY_VERSION,
    updatedAt,
    mode: "shadow",
    observations,
    candidates,
  };
}

export function recordLearningObservation(memory, auditEntry, { updatedAt = new Date().toISOString() } = {}) {
  const next = normalizeMemory(memory);
  const observation = createObservation(auditEntry, updatedAt);
  if (!observation) return next;

  next.observations = [observation, ...next.observations].slice(0, 200);
  next.candidates = deriveLearningCandidates(next.observations);
  next.updatedAt = updatedAt;
  return next;
}

export function deriveLearningCandidates(observations = []) {
  const groups = new Map();
  for (const observation of observations) {
    if (!observation.success || observation.actions.length === 0) continue;
    const key = normalizeCommandKey(observation.input);
    const current = groups.get(key) ?? {
      id: `candidate_${stableId(key)}`,
      type: inferCandidateType(observation.input),
      status: "shadow",
      input: observation.input,
      commandKey: key,
      count: 0,
      confidence: 0,
      actions: observation.actions,
      examples: [],
      safety: {
        level: "low",
        autoApply: false,
        reason: "学习候选默认仅 shadow，不自动执行",
      },
    };
    current.count += 1;
    current.confidence = Math.min(0.95, 0.45 + current.count * 0.15);
    current.examples = [observation.input, ...current.examples.filter((item) => item !== observation.input)].slice(0, 3);
    current.actions = mergeActions(current.actions, observation.actions);
    groups.set(key, current);
  }

  return Array.from(groups.values())
    .filter((candidate) => candidate.count >= 1)
    .sort((first, second) => second.confidence - first.confidence || second.count - first.count)
    .slice(0, 20);
}

export function summarizeLearningMemory(memory) {
  const normalized = normalizeMemory(memory);
  return {
    version: normalized.version,
    updatedAt: normalized.updatedAt,
    mode: normalized.mode,
    observationCount: normalized.observations.length,
    candidateCount: normalized.candidates.length,
    topCandidates: normalized.candidates.slice(0, 5),
  };
}

function createObservation(auditEntry, observedAt) {
  if (!auditEntry?.input) return null;
  const success = ["executed", "dry_run"].includes(auditEntry.status);
  const actions = (auditEntry.execution?.services ?? []).map((service) => ({
    thingId: service.thingId,
    thingName: service.thingName,
    capabilityId: service.capabilityId,
    capabilityName: service.capabilityName,
    service: service.service,
  }));
  return {
    id: auditEntry.commandId,
    observedAt,
    input: auditEntry.input,
    path: auditEntry.path,
    status: auditEntry.status,
    success,
    actions,
    safety: auditEntry.safety,
  };
}

function normalizeMemory(memory) {
  const base = memory && typeof memory === "object" ? memory : {};
  return createLearningMemory({
    updatedAt: base.updatedAt,
    observations: Array.isArray(base.observations) ? base.observations : [],
    candidates: Array.isArray(base.candidates) ? base.candidates : [],
  });
}

function normalizeCommandKey(input) {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/一下|帮我|请|把/g, "")
    .toLowerCase();
}

function inferCandidateType(input) {
  if (/看电影|电影|睡觉|出门|回家|晾衣/.test(input)) return "scene";
  return "command_pattern";
}

function mergeActions(current, next) {
  const byKey = new Map();
  for (const action of [...current, ...next]) {
    byKey.set(`${action.thingId}:${action.capabilityId}:${action.service}`, action);
  }
  return Array.from(byKey.values()).slice(0, 12);
}

function stableId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "unknown";
}
