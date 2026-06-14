import { describe, expect, it } from "vitest";
import { createCommandTrace, finishCommandTrace, runCommandStage, summarizeSafety } from "./commandRuntime.js";

describe("command runtime", () => {
  it("records structured command stages", async () => {
    let now = 1000;
    const clock = () => now;
    const trace = createCommandTrace({ input: "打开客厅灯", now: clock });

    const result = await runCommandStage(
      trace,
      "context_snapshot",
      async () => {
        now += 12;
        return { things: 45 };
      },
      { now: clock, summarize: (value) => ({ things: value.things }) },
    );

    expect(result).toEqual({ things: 45 });
    expect(trace.stages).toEqual([
      expect.objectContaining({
        name: "context_snapshot",
        latencyMs: 12,
        status: "ok",
        summary: { things: 45 },
      }),
    ]);
  });

  it("finishes traces with safety summaries", () => {
    const trace = createCommandTrace({ input: "打开客厅灯", now: () => 1000 });
    const audit = finishCommandTrace(
      trace,
      {
        status: "executed",
        plan: { id: "plan", kind: "real_hcm", intent: "lighting", actions: [{ id: 1 }] },
        execution: {
          status: "executed",
          accepted: [{ thingId: "light", service: "switch.turn_on", risk: "low" }],
          rejected: [],
          results: [{ ok: true }],
        },
      },
      () => 1120,
    );

    expect(audit).toMatchObject({
      input: "打开客厅灯",
      status: "executed",
      latencyMs: 120,
      safety: {
        level: "low",
        confirmationRequired: false,
        executableCount: 1,
      },
    });
  });

  it("summarizes rejected safety gates", () => {
    expect(summarizeSafety({ needsConfirmation: true }, { accepted: [], rejected: [{ code: "blocked" }] })).toMatchObject({
      confirmationRequired: true,
      rejectedCount: 1,
    });
  });
});
