export function explainIntentResult({ input, plan, execution, plannerHints = [] } = {}) {
  const lines = [];
  const targetNames = targetNamesFromPlan(plan);
  const services = execution?.accepted?.map((item) => item.service).filter(Boolean) ?? [];
  const rejected = execution?.rejected ?? [];

  lines.push(`我理解为：${plan?.summary || plan?.intent || input || "未识别指令"}`);
  if (targetNames.length > 0) lines.push(`目标设备：${targetNames.join("、")}`);
  if (plan?.stateQuery) lines.push(`读取状态：${plan.stateQuery.thingName}`);
  if ((plan?.actions ?? []).length > 0) {
    lines.push(`执行能力：${plan.actions.map((action) => `${action.thingName} ${action.capabilityName}`).join("；")}`);
  }
  if (services.length > 0) lines.push(`将调用：${services.join("；")}`);
  if (plannerHints.length > 0) {
    lines.push(`家庭语义：${plannerHints.map((hint) => `${hint.phrase} -> ${hint.candidates[0]?.thingName}`).join("；")}`);
  }
  if (rejected.length > 0) lines.push(`拒绝原因：${rejected.map((item) => item.message || item.code).join("；")}`);
  lines.push(`安全判断：${safetyText(plan, execution)}`);

  return {
    title: plan?.intentType === "state_query" ? "状态读取解释" : "执行计划解释",
    summary: lines.join("\n"),
    intent: {
      type: plan?.intentType ?? "unknown",
      name: plan?.intent ?? "unknown",
      confidence: plan?.confidence ?? 0,
    },
    targets: targetNames,
    services,
    safety: {
      status: execution?.status ?? "unknown",
      dryRun: Boolean(execution?.dryRun),
      rejectedCount: rejected.length,
      needsConfirmation: Boolean(plan?.needsConfirmation),
    },
    hints: plannerHints.map((hint) => ({
      phrase: hint.phrase,
      intent: hint.intent,
      target: hint.candidates[0]?.thingName,
      confidence: hint.candidates[0]?.confidence,
    })),
  };
}

function targetNamesFromPlan(plan) {
  if (!plan) return [];
  const names = new Set();
  if (plan.stateQuery?.thingName) names.add(plan.stateQuery.thingName);
  for (const action of plan.actions ?? []) {
    if (action.thingName) names.add(action.thingName);
  }
  return Array.from(names);
}

function safetyText(plan, execution) {
  if (plan?.kind === "hcm_state_query") return "只读状态查询，不执行设备动作。";
  if (plan?.needsConfirmation) return "需要用户确认后才能执行。";
  if (execution?.status === "dry_run") return "dry-run 预览，不会控制真实设备。";
  if (execution?.status === "rejected") return "安全门已拒绝执行。";
  if (execution?.status === "executed") return "低风险能力已通过 HCM 安全门。";
  if (execution?.status === "no_action") return "没有生成可执行动作。";
  return "已经过 HCM 能力边界和安全策略检查。";
}
