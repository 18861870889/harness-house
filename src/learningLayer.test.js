import { describe, expect, it } from "vitest";
import {
  createLearningMemory,
  deriveLearningCandidates,
  recordLearningObservation,
  summarizeLearningMemory,
} from "./learningLayer.js";

function auditEntry(input = "打开客厅灯") {
  return {
    commandId: crypto.randomUUID(),
    input,
    path: "hcm-real",
    status: "executed",
    execution: {
      services: [
        {
          thingId: "ha_light",
          thingName: "客厅灯",
          capabilityId: "living_light",
          capabilityName: "开关",
          service: "switch.turn_on",
        },
      ],
    },
    safety: { level: "low", confirmationRequired: false },
  };
}

describe("learning layer", () => {
  it("records observations and creates shadow candidates", () => {
    const memory = recordLearningObservation(createLearningMemory(), auditEntry("打开客厅灯"), {
      updatedAt: "2026-06-14T00:00:00.000Z",
    });

    expect(memory.observations).toHaveLength(1);
    expect(memory.candidates).toEqual([
      expect.objectContaining({
        status: "shadow",
        input: "打开客厅灯",
        count: 1,
        safety: expect.objectContaining({ autoApply: false }),
      }),
    ]);
  });

  it("groups repeated commands by normalized key", () => {
    const candidates = deriveLearningCandidates([
      {
        input: "帮我打开客厅灯",
        success: true,
        actions: [{ thingId: "ha_light", capabilityId: "living_light", service: "switch.turn_on" }],
      },
      {
        input: "打开客厅灯",
        success: true,
        actions: [{ thingId: "ha_light", capabilityId: "living_light", service: "switch.turn_on" }],
      },
    ]);

    expect(candidates[0]).toMatchObject({
      count: 2,
      confidence: 0.75,
    });
  });

  it("summarizes memory without exposing raw logs", () => {
    const memory = recordLearningObservation(createLearningMemory(), auditEntry("准备看电影"));

    expect(summarizeLearningMemory(memory)).toMatchObject({
      mode: "shadow",
      observationCount: 1,
      candidateCount: 1,
    });
  });
});
