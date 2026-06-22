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
      const current = sessions.get(sessionId) ?? { turns: [], focusedTargets: [], updatedAt: now() };
      const targets = targetsFromPlan(plan);
      const successful = ["answered", "executed", "dry_run"].includes(execution?.status);
      const turn = {
        input,
        intent: plan.intent,
        intentType: plan.intentType,
        status: execution?.status ?? "unknown",
        targetIds: targets.map((target) => target.id),
        targetNames: targets.map((target) => target.name),
      };
      current.turns = [...current.turns, turn].slice(-MAX_TURNS);
      if (successful && targets.length > 0) current.focusedTargets = targets;
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
    || /^(再|也)(打开|开|关闭|关掉|关|停|停止)/.test(text);
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
    recentTurns: session.turns.map((turn) => ({ ...turn })),
  };
}

function emptyContext() {
  return { version: CONVERSATION_CONTEXT_VERSION, focusedTargets: [], recentTurns: [] };
}

function dedupeTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    if (!target.id || seen.has(target.id)) return false;
    seen.add(target.id);
    return true;
  });
}

function normalize(input) {
  return String(input ?? "").trim().replace(/[，。！？,.!?\s]/g, "");
}
