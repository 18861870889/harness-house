import { describe, expect, it } from "vitest";
import { createHcmHome } from "./hcm.js";
import {
  ENDPOINT_MAPPING_STATUS,
  attachHcmControlGraph,
  buildHcmControlGraph,
  resolveControlAsset,
} from "./hcmControlGraph.js";
import { compileHcmForPlanner, normalizeHcmPlannerDraft } from "./hcmPlanner.js";
import { answerHcmThingStateQuery } from "./hcmStateQuery.js";

function control(id, name, entityId, state = false) {
  return {
    id,
    name,
    kind: "control",
    valueType: "boolean",
    state,
    policy: { risk: "low", confirmation: "never", autoExecutable: true },
    binding: { provider: "home_assistant", domain: "switch", entityId },
  };
}

function createMultiGangHome() {
  return createHcmHome({
    provider: { id: "home_assistant", name: "Home Assistant" },
    spaces: [
      { id: "entry", name: "入户" },
      { id: "dining", name: "餐厅" },
      { id: "study", name: "书房" },
    ],
    things: [
      {
        id: "entry_panel",
        name: "入户1号开关",
        type: "switch_panel",
        spaceId: "entry",
        capabilities: [
          control("dining_spot", "餐厅射灯 开关左键", "switch.entry_left", true),
          control("sideboard_strip", "餐边柜灯带 开关右键", "switch.entry_right", false),
        ],
      },
      {
        id: "study_panel",
        name: "书房开关",
        type: "switch_panel",
        spaceId: "study",
        capabilities: [
          control("study_spot", "书房射灯 开关左键", "switch.study_left", true),
          control("study_ceiling", "书房吊灯 开关中键", "switch.study_middle", false),
          control("study_unused", "右键-书房开关（右键未绑定", "switch.study_right", false),
        ],
      },
    ],
  });
}

describe("HCM control graph", () => {
  it("separates physical controllers, relay endpoints, logical lights, and rooms", () => {
    const graph = buildHcmControlGraph(createMultiGangHome());

    expect(graph.controllers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "入户1号开关",
          installedSpaceId: "entry",
          endpointIds: expect.arrayContaining([
            "endpoint_switch_entry_left",
            "endpoint_switch_entry_right",
          ]),
        }),
      ]),
    );
    expect(graph.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "餐厅射灯", spaceId: "dining" }),
        expect.objectContaining({ name: "餐边柜灯带", spaceId: "dining" }),
        expect.objectContaining({ name: "书房射灯", spaceId: "study" }),
        expect.objectContaining({ name: "书房吊灯", spaceId: "study" }),
      ]),
    );
    expect(graph.assets.some((asset) => asset.name.includes("未绑定"))).toBe(false);
    expect(graph.endpoints).toContainEqual(
      expect.objectContaining({
        entityId: "switch.study_right",
        status: ENDPOINT_MAPPING_STATUS.UNBOUND,
        assetId: null,
      }),
    );
  });

  it("requires review for a cross-room inference until the user confirms it", () => {
    const home = createMultiGangHome();
    const inferred = buildHcmControlGraph(home);
    expect(inferred.endpoints).toContainEqual(
      expect.objectContaining({
        entityId: "switch.entry_left",
        status: ENDPOINT_MAPPING_STATUS.REVIEW,
        targetSpaceId: "dining",
      }),
    );

    const confirmedHome = attachHcmControlGraph(home, {
      mappings: {
        "switch.entry_left": { status: "bound", assetName: "餐厅射灯", spaceId: "dining" },
      },
    });
    const resolved = resolveControlAsset(confirmedHome, "asset_dining_餐厅射灯");
    expect(resolved).toMatchObject({
      asset: { name: "餐厅射灯", spaceId: "dining", mappingStatus: "confirmed" },
      endpoint: { entityId: "switch.entry_left", mappingSource: "user_override" },
      thing: { id: "entry_panel" },
      capability: { id: "dining_spot" },
    });
  });

  it("marks relay state as inferred rather than claiming the lamp is observed", () => {
    const graph = buildHcmControlGraph(createMultiGangHome());
    const asset = graph.assets.find((item) => item.name === "书房射灯");

    expect(asset.state).toEqual({
      commandedState: true,
      observedState: "unknown",
      confidence: "inferred_from_relay",
    });
  });

  it("plans room-wide lighting through two independent channels and ignores the unused key", () => {
    const home = attachHcmControlGraph(createMultiGangHome());
    const plannerDevices = compileHcmForPlanner(home);
    const studyLights = plannerDevices.filter((device) => device.logicalAsset && device.roomId === "study");

    expect(studyLights.map((device) => device.name).sort()).toEqual(["书房吊灯", "书房射灯"]);
    const plan = normalizeHcmPlannerDraft(
      "关闭书房灯",
      {
        intent_type: "scene",
        intent: "turn_off_study_lights",
        confidence: 0.96,
        actions: studyLights.map((device) => ({ device_id: device.id, capability: "power", value: false })),
      },
      home,
    );

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ thingId: "study_panel", capabilityId: "study_spot", logicalRoomId: "study" }),
        expect.objectContaining({ thingId: "study_panel", capabilityId: "study_ceiling", logicalRoomId: "study" }),
      ]),
    );
    expect(plan.actions).toHaveLength(2);
  });

  it("answers logical light state without claiming direct observation", () => {
    const home = attachHcmControlGraph(createMultiGangHome());
    const answer = answerHcmThingStateQuery("书房射灯现在开着吗", home, "asset_study_书房射灯", "查询灯光");

    expect(answer).toMatchObject({
      path: "hcm-control-asset-state",
      thingId: "asset_study_书房射灯",
      roomId: "study",
      controllerId: "controller_study_panel",
    });
    expect(answer.summary).toContain("控制回路已开启");
    expect(answer.summary).toContain("未独立确认灯具实际发光");
  });
});
