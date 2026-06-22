import { describe, expect, it } from "vitest";
import { createHcmHome } from "./hcm.js";
import { attachHcmControlGraph } from "./hcmControlGraph.js";
import { answerHcmInventoryQuery } from "./hcmKnowledgeQuery.js";

function light(id, name, entityId) {
  return {
    id,
    name: `${name}开关`,
    kind: "control",
    valueType: "boolean",
    state: false,
    policy: { risk: "low", confirmation: "never", autoExecutable: true },
    binding: { provider: "home_assistant", domain: "switch", entityId },
  };
}

describe("HCM knowledge query", () => {
  it("answers room inventory counts instead of returning one device state", () => {
    const home = attachHcmControlGraph(createHcmHome({
      provider: { id: "home_assistant", name: "Home Assistant" },
      spaces: [{ id: "living", name: "客厅" }],
      things: [{
        id: "panel",
        name: "客厅开关",
        type: "switch_panel",
        spaceId: "living",
        capabilities: [
          light("spot_1", "客厅射灯1", "switch.spot_1"),
          light("spot_2", "客厅射灯2", "switch.spot_2"),
          light("ceiling", "客厅吊灯", "switch.ceiling"),
        ],
      }],
    }));

    const answer = answerHcmInventoryQuery("客厅有几个射灯", home);

    expect(answer).toMatchObject({ mode: "count", count: 2, roomId: "living" });
    expect(answer.summary).toContain("客厅射灯1、客厅射灯2");
  });
});
