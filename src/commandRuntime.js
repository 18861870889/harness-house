export function createCommandTrace({ input, path = "hcm-real", dryRun = false, replayOf, now = () => Date.now() } = {}) {
  const startedAt = now();
  return {
    commandId: crypto.randomUUID(),
    input,
    path,
    dryRun,
    replayOf,
    startedAt,
    stages: [],
    status: "running",
  };
}

export async function runCommandStage(trace, name, fn, { now = () => Date.now(), summarize = defaultSummary } = {}) {
  const startedAt = now();
  try {
    const result = await fn();
    trace.stages.push({
      name,
      latencyMs: Math.max(0, now() - startedAt),
      status: "ok",
      summary: summarize(result),
    });
    return result;
  } catch (error) {
    trace.stages.push({
      name,
      latencyMs: Math.max(0, now() - startedAt),
      status: "error",
      error: error.message,
    });
    throw error;
  }
}

export function finishCommandTrace(trace, { status, plan, execution, explanation, agents, model, planner } = {}, now = () => Date.now()) {
  const finishedAt = now();
  const safety = summarizeSafety(plan, execution);
  const entry = {
    commandId: trace.commandId,
    input: trace.input,
    path: trace.path,
    dryRun: trace.dryRun,
    replayOf: trace.replayOf,
    status,
    model,
    latencyMs: Math.max(0, finishedAt - trace.startedAt),
    startedAt: new Date(trace.startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    stages: trace.stages,
    planner,
    plan: summarizePlan(plan),
    execution: summarizeExecution(execution),
    explanation: summarizeExplanation(explanation),
    agents: summarizeAgents(agents),
    safety,
  };
  trace.status = status;
  return entry;
}

function summarizeAgents(agents) {
  if (!agents) return null;
  return {
    version: agents.version,
    mode: agents.mode,
    generatedAt: agents.generatedAt,
    summary: agents.summary,
    context: agents.agents?.context
      ? {
          likelySpace: agents.agents.context.likelySpace
            ? {
                id: agents.agents.context.likelySpace.id,
                name: agents.agents.context.likelySpace.name,
                occupied: agents.agents.context.likelySpace.occupied,
                confidence: agents.agents.context.likelySpace.confidence,
              }
            : null,
          occupiedSpaces: agents.agents.context.spaces?.filter((space) => space.occupied).length ?? 0,
        }
      : null,
    mapping: agents.agents?.mapping
      ? {
          candidateCount: agents.agents.mapping.candidates?.length ?? 0,
          protectedCandidates: agents.agents.mapping.summary?.protectedCandidates ?? 0,
        }
      : null,
    diagnostics: agents.agents?.diagnostics
      ? {
          findingCount: agents.agents.diagnostics.findings?.length ?? 0,
          highFindings: agents.agents.diagnostics.findings?.filter((finding) => finding.severity === "high").length ?? 0,
        }
      : null,
  };
}

export function summarizeSafety(plan, execution) {
  const accepted = execution?.accepted ?? [];
  const rejected = execution?.rejected ?? [];
  const highestRisk = accepted.reduce((risk, item) => higherRisk(risk, item.risk || "low"), "low");
  return {
    level: highestRisk,
    confirmationRequired: Boolean(plan?.needsConfirmation),
    rejectedCount: rejected.length,
    executableCount: accepted.length,
    dryRun: Boolean(execution?.dryRun),
  };
}

function summarizePlan(plan) {
  if (!plan) return null;
  return {
    id: plan.id,
    kind: plan.kind,
    intent: plan.intent,
    intentType: plan.intentType,
    confidence: plan.confidence,
    summary: plan.summary,
    actionCount: plan.actions?.length ?? plan.steps?.length ?? 0,
    stateQuery: plan.stateQuery
      ? {
          thingId: plan.stateQuery.thingId,
          thingName: plan.stateQuery.thingName,
          roomId: plan.stateQuery.roomId,
        }
      : null,
    resolution: plan.resolution
      ? {
          type: plan.resolution.type,
          targetStatus: plan.resolution.targetResolution?.status,
          capabilityStatus: plan.resolution.capabilityResolution?.status,
        }
      : null,
    rejected: plan.rejected ?? [],
  };
}

function summarizeExecution(execution) {
  if (!execution) return null;
  return {
    status: execution.status,
    acceptedCount: execution.accepted?.length ?? 0,
    rejectedCount: execution.rejected?.length ?? 0,
    resultCount: execution.results?.length ?? 0,
    services: (execution.accepted ?? []).map((item) => ({
      thingId: item.thingId,
      thingName: item.thingName,
      capabilityId: item.capabilityId,
      capabilityName: item.capabilityName,
      service: item.service,
      simulation: item.simulation,
    })),
    simulation: execution.simulation
      ? {
          ok: execution.simulation.ok,
          rejectedCount: execution.simulation.rejected?.length ?? 0,
          assumedCount: execution.simulation.checks?.filter((check) => check.code === "assumed_supported").length ?? 0,
        }
      : null,
  };
}

function summarizeExplanation(explanation) {
  if (!explanation) return null;
  return {
    title: explanation.title,
    summary: explanation.summary,
    intent: explanation.intent,
    targets: explanation.targets ?? [],
    services: explanation.services ?? [],
    safety: explanation.safety,
    hints: explanation.hints ?? [],
  };
}

function higherRisk(first, second) {
  return riskRank(second) > riskRank(first) ? second : first;
}

function riskRank(risk) {
  if (risk === "sensitive") return 4;
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  if (risk === "low") return 1;
  return 0;
}

function defaultSummary(result) {
  if (Array.isArray(result)) return { count: result.length };
  if (!result || typeof result !== "object") return {};
  if ("stats" in result) return { stats: result.stats };
  if ("actions" in result) return { actionCount: result.actions.length, summary: result.summary };
  if ("accepted" in result) return { accepted: result.accepted.length, rejected: result.rejected.length };
  return {};
}
