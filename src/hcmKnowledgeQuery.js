import { findExplicitRoomIds, getHcmControlGraph } from "./hcmControlGraph.js";

const INVENTORY_PATTERN = /几个|多少个|有哪些|有什么|列出|数量|设备清单/;

export function looksLikeInventoryQuery(input) {
  return INVENTORY_PATTERN.test(String(input ?? ""));
}

export function answerHcmInventoryQuery(input, home, reason = "") {
  if (!looksLikeInventoryQuery(input) || !home) return null;
  const roomIds = findExplicitRoomIds(input, home);
  const roomId = roomIds.length === 1 ? roomIds[0] : null;
  const roomName = home.spaces?.find((space) => space.id === roomId)?.name;
  const category = inferCategory(input);
  const items = inventoryItems(home)
    .filter((item) => !roomId || item.roomId === roomId)
    .filter((item) => matchesCategory(item, category));
  const scope = roomName ?? "全屋";
  const label = category.label ?? "设备";
  const names = items.map((item) => item.name);

  return {
    path: "hcm-inventory-query",
    mode: /几个|多少个|数量/.test(input) ? "count" : "list",
    thingId: null,
    thingName: `${scope}${label}`,
    roomId,
    available: true,
    count: items.length,
    items,
    reason,
    summary: `${scope}共有 ${items.length} 个${label}${names.length > 0 ? `：${names.join("、")}` : ""}。`,
  };
}

function inventoryItems(home) {
  const graph = getHcmControlGraph(home);
  const logicalAssets = graph.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    roomId: asset.spaceId,
    type: asset.type,
    source: "logical_asset",
  }));
  const physicalThings = (home.things ?? [])
    .filter((thing) => thing.type !== "switch_panel")
    .map((thing) => ({ id: thing.id, name: thing.name, roomId: thing.spaceId, type: thing.type, source: "thing" }));
  return dedupeById([...logicalAssets, ...physicalThings]);
}

function inferCategory(input) {
  if (/射灯/.test(input)) return { label: "射灯", namePattern: /射灯/ };
  if (/灯带/.test(input)) return { label: "灯带", namePattern: /灯带/ };
  if (/吊灯/.test(input)) return { label: "吊灯", namePattern: /吊灯/ };
  if (/灯|照明/.test(input)) return { label: "灯", type: "light" };
  if (/空调/.test(input)) return { label: "空调", type: "ac" };
  if (/风扇/.test(input)) return { label: "风扇", type: "fan" };
  if (/窗帘/.test(input)) return { label: "窗帘", type: "curtain" };
  if (/传感器/.test(input)) return { label: "传感器", typePattern: /sensor/ };
  return { label: "设备" };
}

function matchesCategory(item, category) {
  if (category.namePattern) return category.namePattern.test(item.name);
  if (category.typePattern) return category.typePattern.test(item.type);
  if (category.type) return item.type === category.type;
  return true;
}

function dedupeById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}
