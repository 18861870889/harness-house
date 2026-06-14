import { describe, expect, it } from "vitest";
import { createHcmHome } from "./hcm.js";
import { answerHcmStateQuery, looksLikeStateQuery } from "./hcmStateQuery.js";

function createStateHome() {
  return createHcmHome({
    provider: { id: "home_assistant", name: "Home Assistant" },
    spaces: [
      { id: "entry", name: "入户" },
      { id: "living", name: "客厅" },
    ],
    things: [
      {
        id: "ha_entry_motion",
        name: "入户传感器",
        type: "motion_sensor",
        spaceId: "living",
        online: true,
        policy: { risk: "sensitive", confirmation: "always", autoExecutable: false },
        state: { readable: 4, autoExecutable: 0 },
        capabilities: [
          {
            id: "motion",
            name: "移动检测传感器 检测到移动",
            kind: "sensor",
            valueType: "event",
            state: "2026-06-14T13:08:14.678+00:00",
            binding: { entityId: "event.motion_detected", domain: "event" },
          },
          {
            id: "no_motion",
            name: "移动检测传感器 无移动状态持续时间",
            kind: "sensor",
            valueType: "unknown",
            state: "5 Minutes",
            binding: { entityId: "sensor.no_motion_duration", domain: "sensor" },
          },
          {
            id: "battery",
            name: "充电电池 电池电量",
            kind: "sensor",
            valueType: "unknown",
            state: 80,
            binding: { entityId: "sensor.battery", domain: "sensor" },
          },
        ],
      },
    ],
  });
}

describe("HCM state query", () => {
  it("recognizes read-only state questions", () => {
    expect(looksLikeStateQuery("玄关人体目前是什么状态")).toBe(true);
    expect(looksLikeStateQuery("打开玄关灯")).toBe(false);
  });

  it("answers a specific entry motion sensor instead of a whole-home summary", () => {
    const answer = answerHcmStateQuery("玄关人体目前是什么状态", createStateHome());

    expect(answer).toMatchObject({
      path: "hcm-state",
      thingId: "ha_entry_motion",
      thingName: "入户传感器",
    });
    expect(answer.summary).toContain("入户传感器");
    expect(answer.summary).toContain("玄关的入户传感器");
    expect(answer.summary).toContain("无移动持续 5 分钟");
    expect(answer.summary).toContain("电量 80%");
  });
});
