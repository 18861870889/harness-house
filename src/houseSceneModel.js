const ROOM_LAYOUTS = {
  entry: { x: -3.75, z: -3.05, width: 1.9, depth: 1.35, type: "entry" },
  living: { x: 0.7, z: -1.25, width: 4.65, depth: 3.15, type: "living" },
  dining: { x: -2.05, z: -1.2, width: 2.15, depth: 2.45, type: "dining" },
  kitchen: { x: -4.15, z: -0.85, width: 1.95, depth: 2.55, type: "kitchen" },
  bath: { x: -4.15, z: -3.35, width: 1.65, depth: 1.55, type: "bath" },
  balcony: { x: -4.1, z: 1.75, width: 1.85, depth: 3.05, type: "balcony" },
  cat_room: { x: -2.3, z: 2.45, width: 2.65, depth: 2.25, type: "bedroom" },
  second: { x: 0.35, z: 2.55, width: 2.25, depth: 2.25, type: "bedroom" },
  master: { x: 2.8, z: 2.35, width: 2.95, depth: 2.55, type: "bedroom" },
  master_bath: { x: 4.65, z: 0.75, width: 1.45, depth: 1.65, type: "bath" },
  study: { x: 4.45, z: -1.35, width: 2.0, depth: 2.45, type: "study" },
  unknown: { x: 0, z: 4.8, width: 2.4, depth: 1.6, type: "generic" },
};

const ROOM_TYPE_BY_ID = {
  entry: "entry",
  living: "living",
  dining: "dining",
  kitchen: "kitchen",
  study: "study",
  master: "bedroom",
  second: "bedroom",
  cat_room: "bedroom",
  bath: "bath",
  master_bath: "bath",
  balcony: "balcony",
};

const DEVICE_TYPE_PRIORITY = {
  switch_panel: 10,
  light: 11,
  curtain: 20,
  ac: 30,
  fan: 31,
  tv: 40,
  media_player: 41,
  camera: 50,
  motion_sensor: 60,
  presence_sensor: 61,
  door_sensor: 62,
  pet_feeder: 70,
  robot_vacuum: 71,
  washer: 72,
  dryer: 73,
  drying_rack: 74,
  hub: 80,
  scale: 81,
};

export function createHouseSceneModel({ hcmHome, simulatorRooms = [], simulatorDevices = {} } = {}) {
  if (hcmHome?.things?.length > 0) {
    const rooms = createRoomsFromHcm(hcmHome);
    const devices = createDevicesFromHcm(hcmHome, rooms);
    return {
      source: "hcm",
      rooms,
      devices,
    };
  }

  return {
    source: "simulator",
    rooms: simulatorRooms,
    devices: Object.values(simulatorDevices),
  };
}

export function getSceneRoomName(roomId, sceneRooms = []) {
  return sceneRooms.find((room) => room.id === roomId)?.name ?? roomId;
}

function createRoomsFromHcm(home) {
  const displayThings = createLifeViewThings(home);
  const thingCounts = countThingsBySpace(displayThings);
  const activeSpaces = home.spaces.filter((space) => thingCounts.get(space.id) > 0);
  const rooms = activeSpaces.map((space, index) => {
    const layout = ROOM_LAYOUTS[space.id] ?? createFallbackLayout(index);
    return {
      id: space.id,
      name: space.name,
      type: layout.type ?? ROOM_TYPE_BY_ID[space.id] ?? "generic",
      x: layout.x,
      z: layout.z,
      width: layout.width,
      depth: layout.depth,
      presence: hasPresence(home.things, space.id),
      deviceCount: thingCounts.get(space.id) ?? 0,
    };
  });

  return rooms.sort((first, second) => {
    const firstRank = roomRank(first.id);
    const secondRank = roomRank(second.id);
    return firstRank - secondRank || first.name.localeCompare(second.name, "zh-CN");
  });
}

function createDevicesFromHcm(home, sceneRooms) {
  const roomsById = new Map(sceneRooms.map((room) => [room.id, room]));
  const thingsByRoom = new Map();
  for (const thing of createLifeViewThings(home)) {
    const roomId = roomsById.has(thing.spaceId) ? thing.spaceId : "unknown";
    if (!thingsByRoom.has(roomId)) thingsByRoom.set(roomId, []);
    thingsByRoom.get(roomId).push(thing);
  }

  const devices = [];
  for (const [roomId, things] of thingsByRoom) {
    const room = roomsById.get(roomId) ?? ROOM_LAYOUTS.unknown;
    const sorted = [...things].sort(compareThingsForScene);
    sorted.forEach((thing, index) => {
      const [x, z] = devicePointInRoom(room, sorted.length, index, thing.type);
      devices.push(mapThingToSceneDevice(thing, roomId, x, z));
    });
  }
  return devices;
}

function mapThingToSceneDevice(thing, roomId, x, z) {
  const autoExecutable = thing.state?.autoExecutable ?? 0;
  const controllable = thing.state?.controllable ?? 0;
  const readable = thing.state?.readable ?? 0;
  return {
    id: thing.id,
    name: thing.name,
    roomId,
    type: normalizeThingType(thing.type),
    risk: thing.policy?.risk ?? "low",
    online: thing.online,
    source: thing.logicalAsset ? "hcm-control-graph" : "hcm",
    logicalAsset: Boolean(thing.logicalAsset),
    providerThingId: thing.providerThingId,
    sceneX: x,
    sceneZ: z,
    autoExecutable,
    controllable,
    readable,
    statusLabel: thing.logicalAsset
      ? logicalAssetStatusLabel(thing)
      : autoExecutable > 0
        ? `${autoExecutable}/${controllable} auto`
        : readable > 0
          ? `${readable} read`
          : "protected",
  };
}

function createLifeViewThings(home) {
  const graph = getHcmControlGraph(home);
  const logicalAssets = graph.assets
    .map((asset) => {
      const resolved = resolveControlAsset(home, asset.id);
      if (!resolved?.endpoint || !resolved.thing || !resolved.capability) return null;
      return {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        spaceId: asset.spaceId,
        online: resolved.thing.online,
        policy: resolved.capability.policy,
        providerThingId: resolved.thing.id,
        logicalAsset: true,
        state: {
          ...asset.state,
          autoExecutable: resolved.capability.policy?.autoExecutable ? 1 : 0,
          controllable: 1,
          readable: asset.state?.commandedState === "unknown" ? 0 : 1,
        },
      };
    })
    .filter(Boolean);
  if (logicalAssets.length === 0) return home.things;
  return [...home.things.filter((thing) => thing.type !== "switch_panel"), ...logicalAssets];
}

function logicalAssetStatusLabel(thing) {
  const state = thing.state?.commandedState;
  if (state === true) return "回路开启";
  if (state === false) return "回路关闭";
  return thing.online === false ? "控制器离线" : "状态未知";
}

function normalizeThingType(type) {
  if (type === "switch_panel") return "switch_panel";
  if (type === "hub" || type === "scale") return type;
  return type || "generic_entity";
}

function devicePointInRoom(room, total, index, type) {
  const marginX = Math.min(0.48, room.width * 0.24);
  const marginZ = Math.min(0.42, room.depth * 0.22);
  const innerWidth = Math.max(0.35, room.width - marginX * 2);
  const innerDepth = Math.max(0.35, room.depth - marginZ * 2);
  const columns = Math.max(1, Math.ceil(Math.sqrt(total * (innerWidth / innerDepth))));
  const rows = Math.max(1, Math.ceil(total / columns));
  const col = index % columns;
  const row = Math.floor(index / columns);
  const xStep = innerWidth / columns;
  const zStep = innerDepth / rows;
  let x = room.x - innerWidth / 2 + xStep * (col + 0.5);
  let z = room.z - innerDepth / 2 + zStep * (row + 0.5);

  if (type === "curtain") z = room.z + room.depth / 2 - marginZ * 0.8;
  if (type === "door_sensor") z = room.z - room.depth / 2 + marginZ * 0.45;
  if (type === "ac") z = room.z + room.depth / 2 - marginZ * 0.65;
  if (type === "tv") x = room.x + room.width / 2 - marginX * 0.75;
  if (type === "camera") {
    x = room.x + room.width / 2 - marginX * 0.75;
    z = room.z - room.depth / 2 + marginZ * 0.75;
  }

  return [roundPoint(x), roundPoint(z)];
}

function compareThingsForScene(first, second) {
  const firstPriority = DEVICE_TYPE_PRIORITY[first.type] ?? 100;
  const secondPriority = DEVICE_TYPE_PRIORITY[second.type] ?? 100;
  return firstPriority - secondPriority || first.name.localeCompare(second.name, "zh-CN");
}

function countThingsBySpace(things = []) {
  const counts = new Map();
  for (const thing of things) {
    counts.set(thing.spaceId, (counts.get(thing.spaceId) ?? 0) + 1);
  }
  return counts;
}

function hasPresence(things = [], spaceId) {
  return things.some(
    (thing) =>
      thing.spaceId === spaceId &&
      ["presence_sensor", "motion_sensor", "door_sensor"].includes(thing.type),
  );
}

function createFallbackLayout(index) {
  const columns = 4;
  const col = index % columns;
  const row = Math.floor(index / columns);
  return {
    x: -4.2 + col * 2.8,
    z: 4.8 + row * 2,
    width: 2.2,
    depth: 1.65,
    type: "generic",
  };
}

function roomRank(roomId) {
  const rank = [
    "entry",
    "living",
    "dining",
    "kitchen",
    "bath",
    "balcony",
    "cat_room",
    "second",
    "master",
    "master_bath",
    "study",
  ].indexOf(roomId);
  return rank === -1 ? 999 : rank;
}

function roundPoint(value) {
  return Math.round(value * 100) / 100;
}
import { getHcmControlGraph, resolveControlAsset } from "./hcmControlGraph.js";
