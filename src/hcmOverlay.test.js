import { describe, expect, it } from "vitest";
import { createHcmHome } from "./hcm.js";
import {
  BINDING_REVIEW_DECISIONS,
  applyHcmOverlay,
  createHcmOverlay,
  setBindingReviewDecision,
  summarizeOverlay,
} from "./hcmOverlay.js";

function createReviewHome() {
  return createHcmHome({
    provider: { id: "home_assistant", name: "Home Assistant" },
    spaces: [{ id: "living", name: "客厅" }],
    things: [
      {
        id: "ha_switch",
        name: "客厅开关",
        type: "switch_panel",
        spaceId: "living",
        capabilities: [
          {
            id: "left_switch",
            name: "左键",
            kind: "control",
            valueType: "boolean",
            state: false,
            policy: {
              risk: "medium",
              confirmation: "sometimes",
              autoExecutable: false,
              reason: "开关通道语义不清，需要用户确认命名",
            },
            binding: {
              provider: "home_assistant",
              entityId: "switch.living_left",
              domain: "switch",
            },
          },
        ],
      },
    ],
    unresolvedBindings: [
      {
        id: "ha_switch:left_switch",
        thingId: "ha_switch",
        thingName: "客厅开关",
        thingType: "switch_panel",
        spaceId: "living",
        entityId: "switch.living_left",
        entityName: "左键",
        kind: "control",
        valueType: "boolean",
        reason: "开关通道语义不清，需要用户确认命名",
        suggestedRisk: "medium",
        confirmation: "sometimes",
        autoExecutable: false,
      },
    ],
  });
}

describe("hcm overlay", () => {
  it("allows reviewed bindings to become auto executable", () => {
    const overlay = setBindingReviewDecision(createHcmOverlay(), {
      providerId: "home_assistant",
      entityId: "switch.living_left",
      action: BINDING_REVIEW_DECISIONS.ALLOW_AUTO,
      updatedAt: "2026-06-14T00:00:00.000Z",
    });

    const home = applyHcmOverlay(createReviewHome(), overlay);
    const capability = home.things[0].capabilities[0];

    expect(capability.policy).toMatchObject({
      risk: "low",
      confirmation: "never",
      autoExecutable: true,
      overlayDecision: "allow_auto",
    });
    expect(home.stats.autoExecutableCapabilities).toBe(1);
    expect(home.unresolvedBindings).toHaveLength(0);
    expect(home.overlay.bindingOverrideCount).toBe(1);
  });

  it("keeps blocked bindings in the review queue with the user decision", () => {
    const overlay = setBindingReviewDecision(createHcmOverlay(), {
      providerId: "home_assistant",
      entityId: "switch.living_left",
      action: BINDING_REVIEW_DECISIONS.BLOCK,
    });

    const home = applyHcmOverlay(createReviewHome(), overlay);

    expect(home.unresolvedBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: "switch.living_left",
          suggestedRisk: "high",
          confirmation: "always",
          overlayDecision: "block",
        }),
      ]),
    );
    expect(home.review.byRisk.high).toBe(1);
  });

  it("summarizes overlay decisions", () => {
    const overlay = setBindingReviewDecision(createHcmOverlay(), {
      providerId: "home_assistant",
      entityId: "switch.living_left",
      action: BINDING_REVIEW_DECISIONS.REQUIRE_CONFIRMATION,
    });

    expect(summarizeOverlay(overlay)).toMatchObject({
      providerCount: 1,
      bindingOverrideCount: 1,
      decisions: { require_confirmation: 1 },
    });
  });

  it("keeps rebuilt review bindings deduplicated", () => {
    const home = createReviewHome();
    home.things[0].capabilities.push({
      ...home.things[0].capabilities[0],
      binding: {
        ...home.things[0].capabilities[0].binding,
        entityId: "switch.living_left_duplicate",
      },
    });

    const next = applyHcmOverlay(
      home,
      createHcmOverlay({ providers: { home_assistant: { bindings: {}, things: {} } } }),
    );

    expect(next.unresolvedBindings).toHaveLength(1);
  });
});
