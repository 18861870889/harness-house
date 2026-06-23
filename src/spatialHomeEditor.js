export const SPATIAL_EDITOR_VERSION = "0.19";

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

export const SPATIAL_SUGGESTION_TYPES = {
  PLACE_ASSIGNED_DEVICE: "place_assigned_device",
  ASSIGN_PLACED_DEVICE: "assign_placed_device",
  REVIEW_ROOM_MISMATCH: "review_room_mismatch",
};

export function createSpatialEditorState(base = {}) {
  return {
    version: SPATIAL_EDITOR_VERSION,
    floorPlanImage: typeof base.floorPlanImage === "string" ? base.floorPlanImage : null,
    floorPlanImageName: typeof base.floorPlanImageName === "string" ? base.floorPlanImageName : "",
    floorPlanImageSize: Number.isFinite(Number(base.floorPlanImageSize)) ? Number(base.floorPlanImageSize) : 0,
    floorPlanImageUpdatedAt: typeof base.floorPlanImageUpdatedAt === "string" ? base.floorPlanImageUpdatedAt : "",
    roomNames: normalizeRecord(base.roomNames),
    deviceAssignments: normalizeRecord(base.deviceAssignments),
    devicePlacements: normalizePlacementRecord(base.devicePlacements),
    customDeviceNames: normalizeRecord(base.customDeviceNames),
    dismissedSuggestionIds: normalizeStringArray(base.dismissedSuggestionIds),
    namingMode: Object.values(NAMING_MODES).includes(base.namingMode) ? base.namingMode : NAMING_MODES.ROOM_DEFAULT,
  };
}

export function createSpatialEditorModel({ hcmHome, sceneModel, state } = {}) {
  const editorState = createSpatialEditorState(state);
  const rooms = normalizeEditorRooms(sceneModel?.rooms ?? [], editorState);
  const devices = normalizeEditorDevices({ hcmHome, sceneModel, rooms, state: editorState });
  const groups = groupSpatialDevices(devices);
  const suggestions = createSpatialSuggestions({ rooms, devices, state: editorState });
  return {
    version: SPATIAL_EDITOR_VERSION,
    rooms,
    devices,
    groups,
    suggestions,
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

export function dismissSpatialSuggestion(state, suggestionId) {
  const next = createSpatialEditorState(state);
  if (!suggestionId) return next;
  next.dismissedSuggestionIds = Array.from(new Set([...next.dismissedSuggestionIds, suggestionId]));
  return next;
}

export function applySpatialSuggestion(state, suggestion) {
  const next = createSpatialEditorState(state);
  if (!suggestion?.deviceId) return next;
  const roomId = suggestion.roomId || suggestion.patch?.assignmentRoomId || null;
  if (suggestion.patch?.placement) {
    return placeSpatialDevice(next, suggestion.deviceId, {
      x: suggestion.patch.placement.x,
      y: suggestion.patch.placement.y,
      roomId,
    });
  }
  if (roomId) return assignSpatialDevice(next, suggestion.deviceId, roomId);
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

export function applySpatialEditorToScene(sceneModel, spatialModel) {
  if (!sceneModel || !spatialModel) return sceneModel;
  const roomById = new globalThis.Map(spatialModel.rooms.map((room) => [room.id, room]));
  const deviceById = new globalThis.Map(spatialModel.devices.map((device) => [device.id, device]));
  const bounds = calculateSceneBounds(sceneModel.rooms ?? []);
  const projectedDevices = (sceneModel.devices ?? []).map((device) => {
    const spatialDevice = deviceById.get(device.id);
    if (!spatialDevice) return device;
    const placement = spatialDevice.placement;
    const [sceneX, sceneZ] = placement?.placed
      ? editorPointToScenePoint(placement, bounds)
      : [device.sceneX, device.sceneZ];
    const assignedRoomId = roomById.has(spatialDevice.assignedRoomId) ? spatialDevice.assignedRoomId : device.roomId;
    return {
      ...device,
      name: spatialDevice.displayName || device.name,
      roomId: assignedRoomId,
      sceneX,
      sceneZ,
      spatialStatus: spatialDevice.spatialStatus,
      spatialPlacement: placement,
      spatialSource: placement?.placed || assignedRoomId !== device.roomId ? "editor" : device.spatialSource,
    };
  });
  const deviceCounts = countProjectedDevices(projectedDevices);
  const projectedRooms = (sceneModel.rooms ?? []).map((room) => {
    const spatialRoom = roomById.get(room.id);
    return {
      ...room,
      name: spatialRoom?.editorName ?? room.name,
      deviceCount: deviceCounts.get(room.id) ?? 0,
      spatialSource: spatialRoom && spatialRoom.editorName !== room.name ? "editor" : room.spatialSource,
    };
  });
  return {
    ...sceneModel,
    rooms: projectedRooms,
    devices: projectedDevices,
    spatialProjection: {
      version: spatialModel.version,
      applied: true,
      placedDeviceCount: projectedDevices.filter((device) => device.spatialPlacement?.placed).length,
    },
  };
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

function createSpatialSuggestions({ rooms, devices, state }) {
  const roomById = new globalThis.Map(rooms.map((room) => [room.id, room]));
  const dismissed = new Set(state.dismissedSuggestionIds ?? []);
  return devices
    .flatMap((device) => {
      const suggestions = [];
      const assignedRoom = device.assignedRoomId ? roomById.get(device.assignedRoomId) : null;
      const placementRoom = device.placement?.roomId ? roomById.get(device.placement.roomId) : null;
      if (assignedRoom?.mapRect && !device.placement?.placed) {
        suggestions.push(createPlaceSuggestion(device, assignedRoom));
      }
      if (!device.assignedRoomId && placementRoom) {
        suggestions.push(createAssignSuggestion(device, placementRoom));
      }
      if (
        device.assignedRoomId &&
        device.placement?.placed &&
        device.placement.roomId &&
        device.placement.roomId !== device.assignedRoomId &&
        placementRoom
      ) {
        suggestions.push(createRoomMismatchSuggestion(device, placementRoom));
      }
      return suggestions;
    })
    .filter((suggestion) => !dismissed.has(suggestion.id))
    .sort(compareSpatialSuggestions);
}

function createPlaceSuggestion(device, room) {
  return {
    id: `place:${device.id}:${room.id}`,
    type: SPATIAL_SUGGESTION_TYPES.PLACE_ASSIGNED_DEVICE,
    deviceId: device.id,
    deviceName: device.displayName,
    roomId: room.id,
    roomName: room.editorName,
    title: `定位到${room.editorName}`,
    reason: device.role === "physical_controller"
      ? "根据控制器安装房间生成维护定位建议"
      : "根据 HCM 语义房间生成生活视图定位建议",
    confidence: device.role === "logical_asset" ? 0.84 : 0.68,
    patch: {
      assignmentRoomId: room.id,
      placement: { x: room.mapRect.centerX, y: room.mapRect.centerY },
    },
  };
}

function createAssignSuggestion(device, room) {
  return {
    id: `assign:${device.id}:${room.id}`,
    type: SPATIAL_SUGGESTION_TYPES.ASSIGN_PLACED_DEVICE,
    deviceId: device.id,
    deviceName: device.displayName,
    roomId: room.id,
    roomName: room.editorName,
    title: `归入${room.editorName}`,
    reason: "设备已经放在该房间区域内，建议同步房间归属",
    confidence: 0.78,
    patch: { assignmentRoomId: room.id },
  };
}

function createRoomMismatchSuggestion(device, room) {
  return {
    id: `mismatch:${device.id}:${device.assignedRoomId}:${room.id}`,
    type: SPATIAL_SUGGESTION_TYPES.REVIEW_ROOM_MISMATCH,
    deviceId: device.id,
    deviceName: device.displayName,
    roomId: room.id,
    roomName: room.editorName,
    title: `检查${room.editorName}归属`,
    reason: "地图位置和房间归属不一致，建议以当前放置房间为准",
    confidence: 0.58,
    patch: { assignmentRoomId: room.id },
  };
}

function compareSpatialSuggestions(first, second) {
  return second.confidence - first.confidence || first.deviceName.localeCompare(second.deviceName, "zh-CN");
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

function editorPointToScenePoint(placement, bounds) {
  return [
    roundPoint(bounds.minX + (clampPercent(placement.x) / 100) * bounds.width),
    roundPoint(bounds.minZ + (clampPercent(placement.y) / 100) * bounds.depth),
  ];
}

function countProjectedDevices(devices) {
  const counts = new globalThis.Map();
  for (const device of devices ?? []) {
    if (!device.roomId) continue;
    counts.set(device.roomId, (counts.get(device.roomId) ?? 0) + 1);
  }
  return counts;
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number * 100) / 100));
}

function roundPoint(value) {
  return Math.round(value * 100) / 100;
}
