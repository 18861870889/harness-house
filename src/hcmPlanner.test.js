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
        id: "asset_living_客厅灯",
        logicalAsset: true,
        roomId: "living",
        capabilities: [
          expect.objectContaining({
            id: "power",
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

  it("narrows a referential follow-up prompt to the focused logical target", () => {
    const devices = compileHcmForPlanner(createPlannerHome(), {
      input: "关一下",
      focusTargetIds: ["asset_living_客厅灯"],
    });

    expect(devices.map((device) => device.id)).toEqual(["asset_living_客厅灯"]);
  });

  it("resolves a logical light back to its physical switch channel", () => {
    const plan = normalizeHcmPlannerDraft(
      "打开客厅灯",
      {
        intent: "lighting",
        confidence: 0.9,
        actions: [{ device_id: "asset_living_客厅灯", capability: "power", value: true }],
      },
      createPlannerHome(),
    );

    expect(plan.actions).toEqual([
      expect.objectContaining({
        thingId: "ha_light",
        thingName: "客厅灯",
        providerThingName: "客厅灯",
        logicalAssetId: "asset_living_客厅灯",
        logicalRoomId: "living",
        capabilityId: "living_light",
        value: true,
      }),
    ]);
  });

  it("rejects a logical light from a room that conflicts with the explicit user room", () => {
    const plan = normalizeHcmPlannerDraft(
      "打开书房的灯",
      {
        intent: "lighting",
        confidence: 0.7,
        actions: [{ device_id: "asset_living_客厅灯", capability: "power", value: true }],
      },
      createPlannerHome(),
    );

    expect(plan.actions).toEqual([]);
    expect(plan.rejected).toContain("客厅灯 不在用户指定的房间");
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
        summary: "查询玄关传感器",
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
    expect(plan.summary).toBe(plan.stateQuery.summary);
    expect(plan.summary).not.toBe("查询玄关传感器");
  });

  it("answers inventory questions with an aggregate result", () => {
    const plan = normalizeHcmPlannerDraft(
      "客厅有几个灯",
      {
        intent_type: "inventory_query",
        intent: "count_lights",
        confidence: 0.9,
        query: { mode: "count", reason: "统计客厅灯" },
        actions: [],
      },
      createPlannerHome(),
    );

    expect(plan.kind).toBe("hcm_inventory_query");
    expect(plan.stateQuery).toMatchObject({ mode: "count", count: 1, roomId: "living" });
    expect(plan.actions).toEqual([]);
  });

  it("never degrades a rejected control action into a state answer", () => {
    const plan = normalizeHcmPlannerDraft(
      "关闭客厅灯",
      {
        intent_type: "device_control",
        intent: "turn_off_living_light",
        confidence: 0.9,
        query: { mode: "state", device_id: "asset_living_客厅灯" },
        actions: [{ device_id: "asset_living_客厅灯", capability: "power_state", value: false }],
      },
      createPlannerHome(),
    );

    expect(plan.kind).toBe("unresolved_control");
    expect(plan.stateQuery).toBeNull();
    expect(plan.requiresClarification).toBe(true);
    expect(plan.rejected).toContain("客厅灯 不支持 power_state");
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

    expect(plan.kind).toBe("unresolved_control");
    expect(plan.requiresClarification).toBe(true);
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
