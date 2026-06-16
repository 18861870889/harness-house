export const LEARNING_MEMORY_VERSION = "0.1";

export function createLearningMemory({
  updatedAt = new Date().toISOString(),
  candidates = [],
  observations = [],
  tombstones = [],
} = {}) {
  return {
    version: LEARNING_MEMORY_VERSION,
    updatedAt,
    mode: "shadow",
    observations,
    candidates,
    tombstones,
  };
}

export function recordLearningObservation(memory, auditEntry, { updatedAt = new Date().toISOString() } = {}) {
  const next = normalizeMemory(memory);
  const observation = createObservation(auditEntry, updatedAt);
  if (!observation) return next;

  next.observations = [observation, ...next.observations].slice(0, 200);
  next.candidates = deriveLearningCandidates(next.observations, next.candidates, next.tombstones);
  next.updatedAt = updatedAt;
  return next;
}

export function updateLearningCandidate(memory, candidateId, patch = {}, { updatedAt = new Date().toISOString() } = {}) {
  const next = normalizeMemory(memory);
  const candidate = next.candidates.find((item) => item.id === candidateId);
  if (!candidate) throw new Error(`Learning candidate not found: ${candidateId}`);
  const allowedStatuses = new Set(["shadow", "ignored"]);
  if (patch.status && !allowedStatuses.has(patch.status)) {
    throw new Error(`Unsupported learning candidate status: ${patch.status}`);
  }
  candidate.status = patch.status ?? candidate.status;
  candidate.updatedAt = updatedAt;
  candidate.note = typeof patch.note === "string" ? patch.note : candidate.note;
  next.updatedAt = updatedAt;
  return next;
}

export function deleteLearningCandidate(memory, candidateId, { updatedAt = new Date().toISOString() } = {}) {
  const next = normalizeMemory(memory);
  const candidate = next.candidates.find((item) => item.id === candidateId);
  next.candidates = next.candidates.filter((item) => item.id !== candidateId);
  if (candidate) {
    next.tombstones = [
      { id: candidate.id, commandKey: candidate.commandKey, deletedAt: updatedAt },
      ...next.tombstones.filter((item) => item.id !== candidate.id),
    ].slice(0, 100);
  }
  next.updatedAt = updatedAt;
  return next;
}

export function deriveLearningCandidates(observations = [], existingCandidates = [], tombstones = []) {
  const groups = new Map();
  const existingByKey = new Map(existingCandidates.map((candidate) => [candidate.commandKey, candidate]));
  const tombstoneKeys = new Set(tombstones.map((item) => item.commandKey).filter(Boolean));
  for (const observation of observations) {
    if (!observation.success || observation.actions.length === 0) continue;
    const key = normalizeCommandKey(observation.input);
    if (tombstoneKeys.has(key)) continue;
    const existing = existingByKey.get(key);
    const current = groups.get(key) ?? {
      id: `candidate_${stableId(key)}`,
      type: inferCandidateType(observation.input),
      status: existing?.status ?? "shadow",
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
      note: existing?.note,
      updatedAt: existing?.updatedAt,
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
  const correctionCandidates = deriveCorrectionCandidates(normalized.observations);
  return {
    version: normalized.version,
    updatedAt: normalized.updatedAt,
    mode: normalized.mode,
    observationCount: normalized.observations.length,
    candidateCount: normalized.candidates.length,
    ignoredCount: normalized.candidates.filter((candidate) => candidate.status === "ignored").length,
    topCandidates: normalized.candidates.filter((candidate) => candidate.status !== "ignored").slice(0, 5),
    ignoredCandidates: normalized.candidates.filter((candidate) => candidate.status === "ignored").slice(0, 5),
    correctionCandidates,
  };
}

export function deriveCorrectionCandidates(observations = []) {
  const groups = new Map();
  for (const observation of observations) {
    if (!["no_action", "rejected", "partial_failure", "error"].includes(observation.status)) continue;
    const key = normalizeCommandKey(observation.input);
    const current = groups.get(key) ?? {
      id: `correction_${stableId(key)}`,
      type: "correction_needed",
      status: "shadow",
      input: observation.input,
      commandKey: key,
      count: 0,
      confidence: 0,
      reason: inferCorrectionReason(observation),
      examples: [],
      safety: {
        autoApply: false,
        reason: "纠错候选只提示需要补充语义或映射，不自动执行",
      },
    };
    current.count += 1;
    current.confidence = Math.min(0.9, 0.35 + current.count * 0.2);
    current.examples = [observation.input, ...current.examples.filter((item) => item !== observation.input)].slice(0, 3);
    groups.set(key, current);
  }
  return Array.from(groups.values())
    .sort((first, second) => second.confidence - first.confidence || second.count - first.count)
    .slice(0, 5);
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
    explanation: auditEntry.explanation?.summary,
    rejected: auditEntry.execution?.rejectedCount ?? auditEntry.safety?.rejectedCount ?? 0,
  };
}

function inferCorrectionReason(observation) {
  if (observation.status === "no_action") return "没有找到可执行设备或能力，可能需要补充家庭语义/设备映射";
  if (observation.status === "rejected") return "安全门拒绝执行，可能需要确认风险边界或设备能力";
  if (observation.status === "partial_failure") return "部分设备执行失败，可能需要检查 provider service 支持";
  return "命令失败，需要诊断意图、设备或 adapter 映射";
}

function normalizeMemory(memory) {
  const base = memory && typeof memory === "object" ? memory : {};
  return createLearningMemory({
    updatedAt: base.updatedAt,
    observations: Array.isArray(base.observations) ? base.observations : [],
    candidates: Array.isArray(base.candidates) ? base.candidates : [],
    tombstones: Array.isArray(base.tombstones) ? base.tombstones : [],
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
