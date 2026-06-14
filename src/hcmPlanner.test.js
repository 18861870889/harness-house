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
    ],
  });
}

describe("hcm planner compiler", () => {
  it("exposes only auto executable HCM capabilities to the planner", () => {
    const devices = compileHcmForPlanner(createPlannerHome());

    expect(devices).toEqual([
      expect.objectContaining({
        id: "ha_light",
        capabilities: [
          expect.objectContaining({
            id: "living_light",
            operation: "on_off",
          }),
        ],
      }),
    ]);
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
});
