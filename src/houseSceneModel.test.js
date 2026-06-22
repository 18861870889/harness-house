import { describe, expect, it } from "vitest";
import { createHcmHome } from "./hcm.js";
import { attachHcmControlGraph } from "./hcmControlGraph.js";
import { createHouseSceneModel, getSceneRoomName } from "./houseSceneModel.js";

describe("house scene model", () => {
  it("builds room and device points from HCM spaces and things", () => {
    const home = createHcmHome({
      provider: { id: "home_assistant", name: "Home Assistant" },
      spaces: [
        { id: "living", name: "客厅" },
        { id: "cat_room", name: "猫猫房" },
        { id: "master_bath", name: "主卧卫生间" },
      ],
      things: [
        {
          id: "ha_tv",
          name: "电视",
          type: "tv",
          spaceId: "living",
          online: true,
          policy: { risk: "low", confirmation: "never", autoExecutable: true },
          capabilities: [],
          state: { autoExecutable: 3, controllable: 3, readable: 0 },
        },
        {
          id: "ha_feeder",
          name: "猫粮机",
          type: "pet_feeder",
          spaceId: "cat_room",
          online: true,
          policy: { risk: "medium", confirmation: "always", autoExecutable: false },
          capabilities: [],
          state: { autoExecutable: 0, controllable: 2, readable: 5 },
        },
        {
          id: "ha_master_bath_switch",
          name: "主卫开关",
          type: "switch_panel",
          spaceId: "master_bath",
          online: true,
          policy: { risk: "low", confirmation: "never", autoExecutable: true },
          capabilities: [],
          state: { autoExecutable: 2, controllable: 4, readable: 0 },
        },
      ],
    });

    const model = createHouseSceneModel({ hcmHome: home });

    expect(model.source).toBe("hcm");
    expect(model.rooms.map((room) => room.id)).toEqual(["living", "cat_room", "master_bath"]);
    expect(getSceneRoomName("cat_room", model.rooms)).toBe("猫猫房");
    expect(model.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ha_feeder",
          roomId: "cat_room",
          statusLabel: "5 read",
          source: "hcm",
        }),
        expect.objectContaining({
          id: "ha_master_bath_switch",
          roomId: "master_bath",
          statusLabel: "2/4 auto",
        }),
      ]),
    );
    expect(model.devices.every((device) => typeof device.sceneX === "number" && typeof device.sceneZ === "number")).toBe(true);
  });

  it("falls back to simulator rooms and devices when HCM is unavailable", () => {
    const model = createHouseSceneModel({
      simulatorRooms: [{ id: "study", name: "书房", x: 0, z: 0, width: 1, depth: 1 }],
      simulatorDevices: {
        light: { id: "light", name: "书房灯", roomId: "study", type: "light" },
      },
    });

    expect(model).toMatchObject({
      source: "simulator",
      rooms: [expect.objectContaining({ id: "study" })],
      devices: [expect.objectContaining({ id: "light" })],
    });
  });

  it("shows logical lights in their semantic room instead of the physical switch panel", () => {
    const home = attachHcmControlGraph(createHcmHome({
      provider: { id: "home_assistant", name: "Home Assistant" },
      spaces: [
        { id: "entry", name: "入户" },
        { id: "dining", name: "餐厅" },
      ],
      things: [
        {
          id: "entry_panel",
          name: "入户1号开关",
          type: "switch_panel",
          spaceId: "dining",
          online: true,
          capabilities: [
            {
              id: "dining_spot",
              name: "餐厅射灯 开关左键",
              kind: "control",
              valueType: "boolean",
              state: true,
              policy: { risk: "low", confirmation: "never", autoExecutable: true },
              binding: {
                provider: "home_assistant",
                domain: "switch",
                entityId: "switch.entry_panel_on_p_2_1",
              },
            },
          ],
        },
      ],
    }));

    const model = createHouseSceneModel({ hcmHome: home });

    expect(model.devices).toContainEqual(
      expect.objectContaining({
        id: "asset_dining_餐厅射灯",
        name: "餐厅射灯",
        roomId: "dining",
        logicalAsset: true,
        providerThingId: "entry_panel",
        statusLabel: "回路开启",
      }),
    );
    expect(model.devices.some((device) => device.id === "entry_panel")).toBe(false);
  });
});
