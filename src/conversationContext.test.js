import { describe, expect, it } from "vitest";
import { createConversationContextStore, isReferentialControlInput } from "./conversationContext.js";

describe("conversation context", () => {
  it("keeps the last resolved logical target for short follow-up commands", () => {
    const store = createConversationContextStore();
    store.record("session-1", {
      input: "餐厅射灯开着吗",
      plan: {
        intent: "查询餐厅射灯",
        intentType: "state_query",
        stateQuery: { thingId: "asset_dining_spot", thingName: "餐厅射灯", roomId: "dining" },
        actions: [],
      },
      execution: { status: "answered" },
    });

    expect(store.get("session-1").focusedTargets).toEqual([
      { id: "asset_dining_spot", name: "餐厅射灯", roomId: "dining" },
    ]);
    expect(isReferentialControlInput("关一下")).toBe(true);
  });

  it("does not replace focus after a failed command", () => {
    const store = createConversationContextStore();
    store.record("session-1", {
      input: "餐厅射灯开着吗",
      plan: { intent: "query", intentType: "state_query", stateQuery: { thingId: "dining", thingName: "餐厅射灯" } },
      execution: { status: "answered" },
    });
    store.record("session-1", {
      input: "关一下",
      plan: { intent: "wrong", intentType: "device_control", actions: [{ thingId: "study", thingName: "书房吊灯" }] },
      execution: { status: "needs_clarification" },
    });

    expect(store.get("session-1").focusedTargets[0].id).toBe("dining");
  });
});
