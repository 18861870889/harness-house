import { describe, expect, it } from "vitest";
import { createHcmHome } from "./hcm.js";
import { attachHcmControlGraph } from "./hcmControlGraph.js";
import { createHouseSceneModel } from "./houseSceneModel.js";
import {
  assignSpatialDevice,
  clearSpatialPlacement,
  createSpatialEditorModel,
  createSpatialEditorState,
  NAMING_MODES,
  placeSpatialDevice,
  SPATIAL_DEVICE_STATUS,
  updateSpatialDeviceName,
  updateSpatialRoomName,
} from "./spatialHomeEditor.js";

function createSwitchControlledHome() {
  return attachHcmControlGraph(createHcmHome({
    provider: { id: "home_assistant", name: "Home Assistant" },
    spaces: [
      { id: "entry", name: "玄关" },
      { id: "dining", name: "餐厅" },
      { id: "study", name: "书房" },
    ],
    things: [
      {
        id: "entry_switch_1",
        name: "入户一号开关",
        type: "switch_panel",
        spaceId: "entry",
        online: true,
        capabilities: [
          {
            id: "left",
            name: "餐厅射灯 开关左键",
            kind: "control",
            valueType: "boolean",
            state: true,
            policy: { risk: "low", confirmation: "never", autoExecutable: true },
            binding: { provider: "home_assistant", domain: "switch", entityId: "switch.entry_on_p_2_1" },
          },
          {
            id: "right",
            name: "餐厅吊灯 开关右键",
            kind: "control",
            valueType: "boolean",
            state: false,
            policy: { risk: "low", confirmation: "never", autoExecutable: true },
            binding: { provider: "home_assistant", domain: "switch", entityId: "switch.entry_on_p_4_1" },
          },
        ],
      },
    ],
  }));
}

describe("spatial home editor", () => {
  it("keeps logical assets separate from physical switch controllers", () => {
    const hcmHome = createSwitchControlledHome();
    const sceneModel = createHouseSceneModel({ hcmHome });
    const model = createSpatialEditorModel({ hcmHome, sceneModel });

    expect(model.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "餐厅射灯",
          role: "logical_asset",
          assignedRoomId: "dining",
          providerThingId: "entry_switch_1",
          spatialStatus: SPATIAL_DEVICE_STATUS.ASSIGNED_UNPLACED,
        }),
        expect.objectContaining({
          id: "entry_switch_1",
          name: "入户一号开关",
          role: "physical_controller",
          assignedRoomId: "entry",
          statusLabel: "2 通道",
        }),
      ]),
    );
    expect(model.groups[SPATIAL_DEVICE_STATUS.ASSIGNED_UNPLACED].length).toBe(3);
  });

  it("moves a device through placement and assignment states without provider writes", () => {
    const sceneModel = {
      source: "test",
      rooms: [{ id: "study", name: "书房", x: 0, z: 0, width: 2, depth: 2 }],
      devices: [{ id: "desk_light", name: "台灯", type: "light", roomId: null }],
    };
    let state = createSpatialEditorState();

    let model = createSpatialEditorModel({ sceneModel, state });
    expect(model.devices[0].spatialStatus).toBe(SPATIAL_DEVICE_STATUS.UNORGANIZED);

    state = placeSpatialDevice(state, "desk_light", { x: 120, y: -5 });
    model = createSpatialEditorModel({ sceneModel, state });
    expect(model.devices[0]).toMatchObject({
      spatialStatus: SPATIAL_DEVICE_STATUS.PLACED_UNASSIGNED,
      placement: { placed: true, x: 100, y: 0, roomId: null },
    });

    state = assignSpatialDevice(state, "desk_light", "study");
    model = createSpatialEditorModel({ sceneModel, state });
    expect(model.devices[0]).toMatchObject({
      assignedRoomId: "study",
      spatialStatus: SPATIAL_DEVICE_STATUS.ASSIGNED_PLACED,
      placement: { roomId: "study" },
    });

    state = clearSpatialPlacement(state, "desk_light");
    model = createSpatialEditorModel({ sceneModel, state });
    expect(model.devices[0].spatialStatus).toBe(SPATIAL_DEVICE_STATUS.ASSIGNED_UNPLACED);
  });

  it("applies custom room names and naming modes", () => {
    const sceneModel = {
      source: "test",
      rooms: [{ id: "dining", name: "餐厅", x: 0, z: 0, width: 2, depth: 2 }],
      devices: [{ id: "dining_spot", name: "餐厅射灯", type: "light", roomId: "dining" }],
    };
    let state = createSpatialEditorState({ namingMode: NAMING_MODES.ROOM_CUSTOM });
    state = updateSpatialRoomName(state, "dining", "餐区");
    state = updateSpatialDeviceName(state, "dining_spot", "射灯");

    const model = createSpatialEditorModel({ sceneModel, state });

    expect(model.rooms[0].editorName).toBe("餐区");
    expect(model.devices[0].displayName).toBe("餐区射灯");
  });
});
