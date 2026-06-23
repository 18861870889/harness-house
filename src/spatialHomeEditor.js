export const SPATIAL_EDITOR_VERSION = "0.18B";

export const SPATIAL_DEVICE_STATUS = {
  ASSIGNED_PLACED: "assigned_placed",
  ASSIGNED_UNPLACED: "assigned_unplaced",
  PLACED_UNASSIGNED: "placed_unassigned",
  UNORGANIZED: "unorganized",
};

export const NAMING_MODES = {
  ROOM_CUSTOM: "room_custom",
  ROOM_DEFAULT: "room_default",
};

export function createSpatialEditorState(base = {}) {
  return {
    version: SPATIAL_EDITOR_VERSION,
    floorPlanImage: typeof base.floorPlanImage === "string" ? base.floorPlanImage : null,
    roomNames: normalizeRecord(base.roomNames),
    deviceAssignments: normalizeRecord(base.deviceAssignments),
    devicePlacements: normalizePlacementRecord(base.devicePlacements),
    customDeviceNames: normalizeRecord(base.customDeviceNames),
    namingMode: Object.values(NAMING_MODES).includes(base.namingMode) ? base.namingMode : NAMING_MODES.ROOM_DEFAULT,
  };
}

export function createSpatialEditorModel({ hcmHome, sceneModel, state } = {}) {
  const editorState = createSpatialEditorState(state);
  const rooms = normalizeEditorRooms(sceneModel?.rooms ?? [], editorState);
  const devices = normalizeEditorDevices({ hcmHome, sceneModel, rooms, state: editorState });
  const groups = groupSpatialDevices(devices);
  return {
    version: SPATIAL_EDITOR_VERSION,
    rooms,
    devices,
    groups,
    stats: Object.fromEntries(Object.entries(groups).map(([key, items]) => [key, items.length])),
  };
}

export function groupSpatialDevices(devices = []) {
  const groups = {
    [SPATIAL_DEVICE_STATUS.ASSIGNED_PLACED]: [],
    [SPATIAL_DEVICE_STATUS.ASSIGNED_UNPLACED]: [],
    [SPATIAL_DEVICE_STATUS.PLACED_UNASSIGNED]: [],
    [SPATIAL_DEVICE_STATUS.UNORGANIZED]: [],
  };
  for (const device of devices) {
    groups[device.spatialStatus]?.push(device);
  }
  return groups;
}

export function classifySpatialDevice({ assignedRoomId, placement } = {}) {
  const assigned = Boolean(assignedRoomId && assignedRoomId !== "unknown");
  const placed = Boolean(placement?.placed);
  if (assigned && placed) return SPATIAL_DEVICE_STATUS.ASSIGNED_PLACED;
  if (assigned) return SPATIAL_DEVICE_STATUS.ASSIGNED_UNPLACED;
  if (placed) return SPATIAL_DEVICE_STATUS.PLACED_UNASSIGNED;
  return SPATIAL_DEVICE_STATUS.UNORGANIZED;
}

export function placeSpatialDevice(state, deviceId, { x, y, roomId = null } = {}) {
  const next = createSpatialEditorState(state);
  if (!deviceId) return next;
  next.devicePlacements[deviceId] = {
    placed: true,
    x: clampPercent(x),
    y: clampPercent(y),
    roomId: roomId || null,
  };
  next.deviceAssignments[deviceId] = roomId || null;
  return next;
}

export function assignSpatialDevice(state, deviceId, roomId) {
  const next = createSpatialEditorState(state);
  if (!deviceId) return next;
  next.deviceAssignments[deviceId] = roomId || null;
  const placement = next.devicePlacements[deviceId];
  if (placement?.placed) {
    next.devicePlacements[deviceId] = { ...placement, roomId: roomId || null };
  }
  return next;
}

export function clearSpatialPlacement(state, deviceId) {
  const next = createSpatialEditorState(state);
  delete next.devicePlacements[deviceId];
  return next;
}

export function updateSpatialRoomName(state, roomId, name) {
  const next = createSpatialEditorState(state);
  if (!roomId) return next;
  const value = String(name ?? "").trim();
  if (value) next.roomNames[roomId] = value;
  else delete next.roomNames[roomId];
  return next;
}

export function updateSpatialDeviceName(state, deviceId, name) {
  const next = createSpatialEditorState(state);
  if (!deviceId) return next;
  const value = String(name ?? "").trim();
  if (value) next.customDeviceNames[deviceId] = value;
  else delete next.customDeviceNames[deviceId];
  return next;
}

export function composeSpatialDeviceName(device, roomName, state) {
  const editorState = createSpatialEditorState(state);
  const baseName =
    editorState.namingMode === NAMING_MODES.ROOM_CUSTOM
      ? editorState.customDeviceNames[device.id] || stripRoomPrefix(device.name, roomName)
      : device.name;
  if (!roomName) return baseName;
  if (String(baseName).startsWith(roomName)) return baseName;
  return `${roomName}${baseName}`;
}

export function mapSceneRoomToEditorRect(room, bounds) {
  if (!room || !bounds) return null;
  const left = ((room.x - room.width / 2 - bounds.minX) / bounds.width) * 100;
  const top = ((room.z - room.depth / 2 - bounds.minZ) / bounds.depth) * 100;
  return {
    left: clampPercent(left),
    top: clampPercent(top),
    width: clampPercent((room.width / bounds.width) * 100),
    height: clampPercent((room.depth / bounds.depth) * 100),
    centerX: clampPercent(((room.x - bounds.minX) / bounds.width) * 100),
    centerY: clampPercent(((room.z - bounds.minZ) / bounds.depth) * 100),
  };
}

function normalizeEditorRooms(sceneRooms, state) {
  const bounds = calculateSceneBounds(sceneRooms);
  return sceneRooms.map((room) => ({
    ...room,
    editorName: state.roomNames[room.id] || room.name,
    mapRect: mapSceneRoomToEditorRect(room, bounds),
  }));
}

function normalizeEditorDevices({ hcmHome, sceneModel, rooms, state }) {
  const roomById = new globalThis.Map(rooms.map((room) => [room.id, room]));
  const baseDevices = new globalThis.Map();

  for (const device of sceneModel?.devices ?? []) {
    baseDevices.set(device.id, {
      id: device.id,
      name: device.name,
      type: device.type,
      role: device.logicalAsset ? "logical_asset" : "device",
      source: device.source ?? sceneModel?.source ?? "scene",
      defaultRoomId: device.roomId,
      providerThingId: device.providerThingId,
      online: device.online,
      statusLabel: device.statusLabel,
      risk: device.risk,
    });
  }

  for (const controller of hcmHome?.controlGraph?.controllers ?? []) {
    const id = controller.providerThingId || controller.id;
    if (baseDevices.has(id)) continue;
    baseDevices.set(id, {
      id,
      name: controller.name,
      type: "switch_panel",
      role: "physical_controller",
      source: "hcm-control-graph",
      defaultRoomId: controller.installedSpaceId,
      online: controller.online,
      statusLabel: `${controller.endpointIds?.length ?? 0} 通道`,
      risk: "low",
    });
  }

  return Array.from(baseDevices.values())
    .map((device) => {
      const assignedRoomId = Object.prototype.hasOwnProperty.call(state.deviceAssignments, device.id)
        ? state.deviceAssignments[device.id]
        : device.defaultRoomId;
      const assignedRoom = assignedRoomId ? roomById.get(assignedRoomId) : null;
      const placement = state.devicePlacements[device.id] ?? null;
      return {
        ...device,
        assignedRoomId: assignedRoomId || null,
        assignedRoomName: assignedRoom?.editorName ?? null,
        placement,
        spatialStatus: classifySpatialDevice({ assignedRoomId, placement }),
        displayName: composeSpatialDeviceName(device, assignedRoom?.editorName, state),
      };
    })
    .sort(compareSpatialDevices);
}

function compareSpatialDevices(first, second) {
  const roleDelta = roleRank(first.role) - roleRank(second.role);
  if (roleDelta !== 0) return roleDelta;
  const statusDelta = statusRank(first.spatialStatus) - statusRank(second.spatialStatus);
  if (statusDelta !== 0) return statusDelta;
  return first.displayName.localeCompare(second.displayName, "zh-CN");
}

function roleRank(role) {
  if (role === "logical_asset") return 0;
  if (role === "device") return 1;
  if (role === "physical_controller") return 2;
  return 3;
}

function statusRank(status) {
  return [
    SPATIAL_DEVICE_STATUS.ASSIGNED_PLACED,
    SPATIAL_DEVICE_STATUS.ASSIGNED_UNPLACED,
    SPATIAL_DEVICE_STATUS.PLACED_UNASSIGNED,
    SPATIAL_DEVICE_STATUS.UNORGANIZED,
  ].indexOf(status);
}

function calculateSceneBounds(rooms) {
  if (!rooms?.length) return { minX: 0, minZ: 0, width: 1, depth: 1 };
  const minX = Math.min(...rooms.map((room) => room.x - room.width / 2));
  const maxX = Math.max(...rooms.map((room) => room.x + room.width / 2));
  const minZ = Math.min(...rooms.map((room) => room.z - room.depth / 2));
  const maxZ = Math.max(...rooms.map((room) => room.z + room.depth / 2));
  return {
    minX,
    minZ,
    width: Math.max(0.1, maxX - minX),
    depth: Math.max(0.1, maxZ - minZ),
  };
}

function stripRoomPrefix(name, roomName) {
  if (!roomName) return name;
  const text = String(name ?? "");
  return text.startsWith(roomName) ? text.slice(roomName.length) || text : text;
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => key && (typeof entry === "string" || entry === null)));
}

function normalizePlacementRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, placement]) => placement && typeof placement === "object")
      .map(([key, placement]) => [
        key,
        {
          placed: Boolean(placement.placed),
          x: clampPercent(placement.x),
          y: clampPercent(placement.y),
          roomId: placement.roomId || null,
        },
      ]),
  );
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number * 100) / 100));
}
