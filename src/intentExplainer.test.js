import { describe, expect, it } from "vitest";
import { buildHcmExecutionPlan } from "./hcmExecutor.js";
import { normalizeHcmPlannerDraft } from "./hcmPlanner.js";
import { createHarnessScenarioHome } from "./harnessScenario.fixture.js";
import { simulateHcmServiceCalls } from "./homeAssistantServiceSimulator.js";
import { explainIntentResult } from "./intentExplainer.js";
import { compilePersonalSemanticsForPlanner } from "./personalSemantics.js";

describe("intent explainer", () => {
  it("explains a dry-run control plan with target, service, semantics, and safety", () => {
    const home = createHarnessScenarioHome();
    const plan = normalizeHcmPlannerDraft(
      "我要晾衣服",
      {
        intent_type: "scene",
        intent: "prepare_laundry_drying",
        summary: "准备晾衣服",
        confidence: 0.88,
        actions: [{ device_id: "balcony_drying_rack", capability: "drying_rack_position", value: 100 }],
      },
      home,
    );
    const executionPlan = buildHcmExecutionPlan(plan.actions, home);
    const simulation = simulateHcmServiceCalls(executionPlan.accepted, home);
    const explanation = explainIntentResult({
      input: "我要晾衣服",
      plan,
      execution: {
        status: "dry_run",
        dryRun: true,
        accepted: executionPlan.accepted.map((item) => ({
          thingName: item.thing.name,
          capabilityName: item.capability.name,
          service: `${item.serviceCall.domain}.${item.serviceCall.service}`,
        })),
        rejected: [],
        simulation,
      },
      plannerHints: compilePersonalSemanticsForPlanner("我要晾衣服", home),
    });

    expect(explanation.summary).toContain("我理解为：准备晾衣服");
    expect(explanation.summary).toContain("目标设备：阳台晾衣杆");
    expect(explanation.summary).toContain("将调用：cover.set_cover_position");
    expect(explanation.summary).toContain("模拟校验：通过，未触碰真实设备");
    expect(explanation.summary).toContain("家庭语义：晾衣服 -> 阳台晾衣杆");
    expect(explanation.summary).toContain("dry-run 预览，不会控制真实设备");
  });

  it("explains read-only state queries as non-executing results", () => {
    const plan = normalizeHcmPlannerDraft(
      "玄关人体目前是什么状态",
      {
        intent_type: "state_query",
        intent: "query_entry_motion",
        confidence: 0.92,
        query: { device_id: "entry_motion", reason: "询问玄关人体状态" },
        actions: [],
      },
      createHarnessScenarioHome(),
    );
    const explanation = explainIntentResult({
      input: "玄关人体目前是什么状态",
      plan,
      execution: { status: "answered", dryRun: true, accepted: [], rejected: [] },
    });

    expect(explanation.title).toBe("状态读取解释");
    expect(explanation.summary).toContain("读取结果：玄关的入户传感器");
    expect(explanation.summary).toContain("只读状态查询，不执行设备动作");
  });
});
