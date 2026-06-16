import { describe, expect, it } from "vitest";
import { createHcmHome } from "./hcm.js";
import { compileHcmForPlanner, normalizeHcmPlannerDraft } from "./hcmPlanner.js";

function createPlannerHome() {
  return createHcmHome({
    provider: { id: "home_assistant", name: "Home Assistant" },
    spaces: [{ id: "living", name: "客厅" }],
    things: [
      {
        id: "ha_light",
        name: "客厅灯",
        type: "switch_panel",
        spaceId: "living",
        capabilities: [
          {
            id: "living_light",
            name: "客厅灯开关",
            kind: "control",
            valueType: "boolean",
            policy: { risk: "low", confirmation: "never", autoExecutable: true },
            binding: { provider: "home_assistant", domain: "switch", entityId: "switch.living_light" },
          },
          {
            id: "config",
            name: "互控配置",
            kind: "config",
            valueType: "text",
            policy: { risk: "high", confirmation: "always", autoExecutable: false },
            binding: { provider: "home_assistant", domain: "text", entityId: "text.config" },
          },
        ],
      },
      {
        id: "entry_motion",
        name: "入户传感器",
        type: "motion_sensor",
        spaceId: "living",
        capabilities: [
          {
            id: "motion",
            name: "检测到移动",
            kind: "sensor",
            valueType: "boolean",
            state: false,
            policy: { risk: "sensitive", confirmation: "always", autoExecutable: false },
            binding: { provider: "home_assistant", domain: "binary_sensor", entityId: "binary_sensor.entry_motion" },
          },
          {
            id: "battery",
            name: "电池电量",
            kind: "sensor",
            valueType: "number",
            state: 80,
            unit: "%",
            policy: { risk: "low", confirmation: "never", autoExecutable: false },
            binding: { provider: "home_assistant", domain: "sensor", entityId: "sensor.entry_motion_battery" },
          },
        ],
      },
    ],
  });
}

describe("hcm planner compiler", () => {
  it("exposes only auto executable HCM capabilities to the planner", () => {
    const devices = compileHcmForPlanner(createPlannerHome());

    expect(devices).toEqual(
      expect.arrayContaining([
      expect.objectContaining({
        id: "ha_light",
        capabilities: [
          expect.objectContaining({
            id: "living_light",
            operation: "on_off",
          }),
        ],
      }),
      expect.objectContaining({
        id: "entry_motion",
        capabilities: [
          expect.objectContaining({
            id: "motion",
            access: "read",
            operation: "read_state",
          }),
          expect.objectContaining({
            id: "battery",
            access: "read",
            operation: "read_state",
          }),
        ],
      }),
      ]),
    );
  });

  it("normalizes model drafts into HCM actions", () => {
    const plan = normalizeHcmPlannerDraft(
      "打开客厅灯",
      {
        intent: "lighting",
        confidence: 0.8,
        summary: "打开客厅灯",
        actions: [{ device_id: "ha_light", capability: "living_light", value: true }],
      },
      createPlannerHome(),
    );

    expect(plan.kind).toBe("real_hcm");
    expect(plan.actions).toEqual([
      expect.objectContaining({
        thingId: "ha_light",
        capabilityId: "living_light",
        value: true,
      }),
    ]);
  });

  it("normalizes model state queries into read-only HCM answers", () => {
    const plan = normalizeHcmPlannerDraft(
      "玄关人体目前是什么状态",
      {
        intent_type: "state_query",
        intent: "query_motion_sensor",
        confidence: 0.9,
        actions: [],
        query: { device_id: "entry_motion", reason: "用户询问玄关人体状态" },
      },
      createPlannerHome(),
    );

    expect(plan.kind).toBe("hcm_state_query");
    expect(plan.intentType).toBe("state_query");
    expect(plan.stateQuery).toEqual(
      expect.objectContaining({
        thingId: "entry_motion",
        thingName: "入户传感器",
      }),
    );
    expect(plan.resolution).toMatchObject({
      type: "state_query",
      targetResolution: { status: "resolved" },
      capabilityResolution: { status: "read_only" },
    });
    expect(plan.actions).toEqual([]);
  });

  it("does not allow read-only sensor capabilities as executable actions", () => {
    const plan = normalizeHcmPlannerDraft(
      "玄关人体目前是什么状态",
      {
        intent_type: "device_control",
        intent: "bad_sensor_action",
        confidence: 0.7,
        actions: [{ device_id: "entry_motion", capability: "motion", value: true }],
      },
      createPlannerHome(),
    );

    expect(plan.kind).toBe("empty");
    expect(plan.rejected).toEqual(["入户传感器 检测到移动 不是可执行控制能力"]);
  });

  it("treats valid actions as control even when the model also emits a query object", () => {
    const plan = normalizeHcmPlannerDraft(
      "打开客厅灯",
      {
        intent_type: "device_control",
        intent: "turn_on_light",
        confidence: 0.8,
        query: { device_id: "ha_light", reason: "模型附带的冗余 query" },
        actions: [{ device_id: "ha_light", capability: "living_light", value: true }],
      },
      createPlannerHome(),
    );

    expect(plan.kind).toBe("real_hcm");
    expect(plan.stateQuery).toBeNull();
    expect(plan.actions).toHaveLength(1);
  });
});
