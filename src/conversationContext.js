export const CONVERSATION_CONTEXT_VERSION = "0.1";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_TURNS = 6;

export function createConversationContextStore({ now = () => Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const sessions = new Map();

  return {
    get(sessionId) {
      if (!sessionId) return emptyContext();
      const session = sessions.get(sessionId);
      if (!session || now() - session.updatedAt > ttlMs) {
        sessions.delete(sessionId);
        return emptyContext();
      }
      return compactContext(session);
    },
    record(sessionId, { input, plan, execution } = {}) {
      if (!sessionId || !input || !plan) return emptyContext();
      const current = sessions.get(sessionId) ?? { turns: [], focusedTargets: [], focusedRooms: [], updatedAt: now() };
      const targets = targetsFromPlan(plan);
      const rooms = roomsFromPlan(plan, targets);
      const successful = ["answered", "executed", "dry_run"].includes(execution?.status);
      const turn = {
        input,
        intent: plan.intent,
        intentType: plan.intentType,
        status: execution?.status ?? "unknown",
        targetIds: targets.map((target) => target.id),
        targetNames: targets.map((target) => target.name),
        roomIds: rooms.map((room) => room.id),
      };
      current.turns = [...current.turns, turn].slice(-MAX_TURNS);
      if (successful) {
        if (targets.length > 0) current.focusedTargets = targets;
        else if (rooms.length > 0) current.focusedTargets = [];
        if (rooms.length > 0) current.focusedRooms = rooms;
      }
      current.updatedAt = now();
      sessions.set(sessionId, current);
      return compactContext(current);
    },
    clear(sessionId) {
      sessions.delete(sessionId);
    },
  };
}

export function isReferentialControlInput(input) {
  const text = normalize(input);
  return /^(把)?(它|这个|那个)?(也)?(打开|开|关闭|关掉|关|停|停止|调一下|开一下|关一下)$/.test(text)
    || /^(再|也)(打开|开|关闭|关掉|关|停|停止)/.test(text)
    || isComfortFollowUpInput(input);
}

export function isComfortFollowUpInput(input) {
  const text = normalize(input);
  return /^(还是)?(有点|太|不够|再)?(暗|亮|热|冷|闷)(啊|了|一点|点)?$/.test(text)
    || /^(还是)?(有点)?不够亮(啊|了)?$/.test(text)
    || /^(再)?亮一点$/.test(text)
    || /^暗一点$/.test(text);
}

function targetsFromPlan(plan) {
  const targets = [];
  if (plan.stateQuery?.thingId) {
    targets.push({ id: plan.stateQuery.thingId, name: plan.stateQuery.thingName, roomId: plan.stateQuery.roomId });
  }
  for (const action of plan.actions ?? []) {
    targets.push({
      id: action.logicalAssetId ?? action.thingId,
      name: action.logicalAssetName ?? action.thingName,
      roomId: action.logicalRoomId,
    });
  }
  return dedupeTargets(targets);
}

function compactContext(session) {
  return {
    version: CONVERSATION_CONTEXT_VERSION,
    focusedTargets: session.focusedTargets.map((target) => ({ ...target })),
    focusedRooms: (session.focusedRooms ?? []).map((room) => ({ ...room })),
    recentTurns: session.turns.map((turn) => ({ ...turn })),
  };
}

function emptyContext() {
  return { version: CONVERSATION_CONTEXT_VERSION, focusedTargets: [], focusedRooms: [], recentTurns: [] };
}

function dedupeTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (!target.id || seen.has(target.id)) return false;
    seen.add(target.id);
    return true;
  });
}

function roomsFromPlan(plan, targets = []) {
  const rooms = [];
  if (plan.stateQuery?.roomId) rooms.push({ id: plan.stateQuery.roomId, name: plan.stateQuery.roomName });
  for (const target of targets) {
    if (target.roomId) rooms.push({ id: target.roomId });
  }
  for (const action of plan.actions ?? []) {
    if (action.logicalRoomId) rooms.push({ id: action.logicalRoomId });
  }
  return dedupeRooms(rooms);
}

function dedupeRooms(rooms) {
  const seen = new Set();
  return rooms.filter((room) => {
    if (!room.id || seen.has(room.id)) return false;
    seen.add(room.id);
    return true;
  });
}

function normalize(input) {
  return String(input ?? "").trim().replace(/[，。！？,.!?\s]/g, "");
}
