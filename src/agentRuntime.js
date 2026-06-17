const AGENT_RUNTIME_VERSION = "0.1";

export function runAgentRuntime({ home, auditEntries = [], generatedAt = new Date().toISOString() } = {}) {
  const context = runContextAgent({ home, generatedAt });
  const mapping = runMappingAgent({ home, generatedAt });
  const diagnostics = runDiagnosticsAgent({ home, auditEntries, generatedAt });

  return {
    version: AGENT_RUNTIME_VERSION,
    generatedAt,
    mode: "shadow",
    summary: {
      agentCount: 3,
      occupancySpaces: context.spaces.length,
      mappingCandidates: mapping.candidates.length,
      diagnosticsFindings: diagnostics.findings.length,
      actionRequired:
        mapping.candidates.some((candidate) => candidate.severity !== "low") ||
        diagnostics.findings.some((finding) => finding.severity !== "low"),
    },
    agents: {
      context,
      mapping,
      diagnostics,
    },
  };
}

export function runContextAgent({ home, generatedAt = new Date().toISOString() } = {}) {
  const spaces = new Map((home?.spaces ?? []).map((space) => [space.id, { id: space.id, name: space.name }]));
  for (const thing of home?.things ?? []) {
    if (!spaces.has(thing.spaceId)) spaces.set(thing.spaceId, { id: thing.spaceId, name: thing.spaceId });
  }

  const evidenceBySpace = new Map();
  for (const thing of home?.things ?? []) {
    const evidence = occupancyEvidenceForThing(thing, generatedAt);
    if (!evidence) continue;
    const list = evidenceBySpace.get(thing.spaceId) ?? [];
    list.push(evidence);
    evidenceBySpace.set(thing.spaceId, list);
  }

  const spaceStates = Array.from(spaces.values())
    .map((space) => {
      const evidence = evidenceBySpace.get(space.id) ?? [];
      const confidence = evidence.reduce((max, item) => Math.max(max, item.confidence), 0);
      return {
        ...space,
        occupied: confidence >= 0.6,
        confidence: roundConfidence(confidence),
        sources: evidence
          .sort((first, second) => second.confidence - first.confidence)
          .slice(0, 4)
          .map((item) => ({
            thingId: item.thingId,
            thingName: item.thingName,
            signal: item.signal,
            confidence: roundConfidence(item.confidence),
          })),
        updatedAt: generatedAt,
      };
    })
    .sort((first, second) => second.confidence - first.confidence || first.name.localeCompare(second.name, "zh-CN"));

  return {
    id: "context_agent",
    name: "Context Agent",
    status: "ok",
    mode: "shadow",
    generatedAt,
    likelySpace: spaceStates[0]?.confidence > 0 ? spaceStates[0] : null,
    spaces: spaceStates,
  };
}

export function runMappingAgent({ home, generatedAt = new Date().toISOString() } = {}) {
  const unresolvedByThing = new Map();
  for (const binding of home?.unresolvedBindings ?? []) {
    mergeMappingSignal(unresolvedByThing, {
      thingId: binding.thingId,
      thingName: binding.thingName,
      thingType: binding.thingType,
      spaceId: binding.spaceId,
      entityId: binding.entityId,
      entityName: binding.entityName,
      kind: binding.kind,
      valueType: binding.valueType,
      reason: binding.reason,
      risk: binding.suggestedRisk,
    });
  }

  for (const thing of home?.things ?? []) {
    for (const capability of thing.capabilities ?? []) {
      if (!requiresMappingReview(capability, thing)) continue;
      mergeMappingSignal(unresolvedByThing, {
        thingId: thing.id,
        thingName: thing.name,
        thingType: thing.type,
        spaceId: thing.spaceId,
        entityId: capability.binding?.entityId,
        entityName: capability.name,
        kind: capability.kind,
        valueType: capability.valueType,
        reason: capability.policy?.reason || "能力边界需要确认",
        risk: capability.policy?.risk,
      });
    }
  }

  const candidates = Array.from(unresolvedByThing.values())
    .map((candidate) => {
      const dominantReason = topEntry(candidate.reasons)?.[0] ?? "需要人工确认能力边界";
      const severity = mappingSeverity(candidate);
      return {
        ...candidate,
        severity,
        confidence: mappingConfidence(candidate),
        proposedAction: mappingActionForSeverity(severity),
        reason: dominantReason,
      };
    })
    .sort((first, second) => severityRank(second.severity) - severityRank(first.severity) || second.count - first.count)
    .slice(0, 12);

  const genericThings = (home?.things ?? []).filter((thing) => ["generic", "generic_device", "switch_panel"].includes(thing.type));

  return {
    id: "mapping_agent",
    name: "Mapping Agent",
    status: "ok",
    mode: "shadow",
    generatedAt,
    candidates,
    summary: {
      unresolvedThings: unresolvedByThing.size,
      genericThingCount: genericThings.length,
      protectedCandidates: candidates.filter((candidate) => ["high", "critical"].includes(candidate.severity)).length,
    },
  };
}

function mergeMappingSignal(groups, signal) {
  const key = signal.thingId || signal.thingName || signal.entityId;
  const current = groups.get(key) ?? {
    thingId: signal.thingId,
    thingName: signal.thingName ?? "未命名设备",
    thingType: signal.thingType ?? "generic",
    spaceId: signal.spaceId,
    count: 0,
    reasons: {},
    risks: {},
    examples: [],
  };
  const exampleKey = `${signal.entityId}:${signal.kind}`;
  const alreadyTracked = current.examples.some((example) => `${example.entityId}:${example.kind}` === exampleKey);
  if (!alreadyTracked) {
    current.count += 1;
    if (current.examples.length < 3) {
      current.examples.push({
        entityId: signal.entityId,
        entityName: signal.entityName,
        kind: signal.kind,
        valueType: signal.valueType,
      });
    }
  }
  current.reasons[signal.reason || "未分类"] = (current.reasons[signal.reason || "未分类"] || 0) + 1;
  current.risks[signal.risk || "unknown"] = (current.risks[signal.risk || "unknown"] || 0) + 1;
  groups.set(key, current);
}

function requiresMappingReview(capability, thing) {
  if (capability.kind === "sensor" && capability.policy?.risk === "low") return false;
  if (capability.policy?.risk && capability.policy.risk !== "low") return true;
  if (capability.policy?.autoExecutable === false && ["control", "action", "config"].includes(capability.kind)) return true;
  return ["generic", "generic_device", "switch_panel"].includes(thing.type) && capability.kind !== "sensor";
}

export function runDiagnosticsAgent({ home, auditEntries = [], generatedAt = new Date().toISOString() } = {}) {
  const findings = [];
  const offlineThings = (home?.things ?? []).filter((thing) => thing.online === false);
  if (offlineThings.length > 0) {
    findings.push({
      id: "offline_things",
      severity: "medium",
      title: "设备离线",
      message: `${offlineThings.length} 个 HCM 设备当前离线`,
      targets: offlineThings.slice(0, 5).map((thing) => ({ thingId: thing.id, thingName: thing.name })),
    });
  }

  const recent = auditEntries.slice(0, 20);
  const failed = recent.filter((entry) => ["rejected", "partial_failure", "error"].includes(entry.status));
  if (failed.length > 0) {
    findings.push({
      id: "recent_command_failures",
      severity: failed.length >= 3 ? "high" : "medium",
      title: "近期指令失败",
      message: `最近 ${recent.length} 条审计中有 ${failed.length} 条失败或被拒绝`,
      targets: failed.slice(0, 4).map((entry) => ({
        commandId: entry.commandId,
        input: entry.input,
        status: entry.status,
      })),
    });
  }

  const simulationRejected = recent.filter((entry) => (entry.execution?.simulation?.rejectedCount ?? 0) > 0);
  if (simulationRejected.length > 0) {
    findings.push({
      id: "service_simulation_rejections",
      severity: "high",
      title: "HA 服务模拟拦截",
      message: `${simulationRejected.length} 条指令在真实执行前被 simulator 拦截`,
      targets: simulationRejected.slice(0, 4).map((entry) => ({
        commandId: entry.commandId,
        input: entry.input,
        rejectedCount: entry.execution?.simulation?.rejectedCount,
      })),
    });
  }

  const noAutoCapabilities = (home?.stats?.autoExecutableCapabilities ?? 0) === 0;
  if (noAutoCapabilities) {
    findings.push({
      id: "no_auto_capabilities",
      severity: "high",
      title: "没有自动可执行能力",
      message: "当前 HCM 没有开放给 AI 自动执行的低风险能力",
      targets: [],
    });
  }

  const slowCommands = recent.filter((entry) => (entry.latencyMs ?? 0) > 2000);
  if (slowCommands.length > 0) {
    findings.push({
      id: "latency_budget",
      severity: "low",
      title: "2 秒链路预算",
      message: `${slowCommands.length} 条近期指令超过 2 秒`,
      targets: slowCommands.slice(0, 4).map((entry) => ({
        commandId: entry.commandId,
        input: entry.input,
        latencyMs: entry.latencyMs,
      })),
    });
  }

  return {
    id: "diagnostics_agent",
    name: "Diagnostics Agent",
    status: "ok",
    mode: "shadow",
    generatedAt,
    findings,
    summary: {
      offlineThingCount: offlineThings.length,
      recentAuditCount: recent.length,
      failedCommandCount: failed.length,
      simulationRejectedCount: simulationRejected.length,
      slowCommandCount: slowCommands.length,
    },
  };
}

function occupancyEvidenceForThing(thing, generatedAt) {
  const type = thing.type;
  if (!["presence_sensor", "motion_sensor", "door_sensor"].includes(type)) return null;

  const activeCapability = (thing.capabilities ?? []).find((capability) => isActivePresenceState(capability.state));
  if (!activeCapability) return null;

  if (type === "presence_sensor") {
    return {
      thingId: thing.id,
      thingName: thing.name,
      signal: "presence",
      confidence: 0.92,
      updatedAt: generatedAt,
    };
  }
  if (type === "motion_sensor") {
    return {
      thingId: thing.id,
      thingName: thing.name,
      signal: "motion",
      confidence: 0.64,
      updatedAt: generatedAt,
    };
  }
  return {
    thingId: thing.id,
    thingName: thing.name,
    signal: "door_open",
    confidence: 0.36,
    updatedAt: generatedAt,
  };
}

function isActivePresenceState(state) {
  if (state === true || state === "on" || state === "open" || state === "detected" || state === "motion") return true;
  if (typeof state === "string" && /^\d{4}-\d{2}-\d{2}t/i.test(state)) return true;
  return false;
}

function mappingSeverity(candidate) {
  if (candidate.risks.sensitive || candidate.risks.high) return "critical";
  if (candidate.risks.medium) return "medium";
  if (candidate.thingType === "switch_panel" || candidate.thingType === "generic_device") return "medium";
  return "low";
}

function mappingConfidence(candidate) {
  if (candidate.thingType === "generic_device") return 0.45;
  if (candidate.thingType === "switch_panel") return 0.58;
  if (candidate.count >= 3) return 0.72;
  return 0.64;
}

function mappingActionForSeverity(severity) {
  if (severity === "critical") return "protect";
  if (severity === "medium") return "review";
  return "auto_candidate";
}

function topEntry(record) {
  return Object.entries(record).sort(([, first], [, second]) => second - first)[0];
}

function severityRank(severity) {
  if (severity === "critical") return 3;
  if (severity === "high") return 2;
  if (severity === "medium") return 1;
  return 0;
}

function roundConfidence(value) {
  return Math.round(value * 100) / 100;
}
