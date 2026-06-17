import { describe, expect, it } from "vitest";
import { createHarnessScenarioHome } from "./harnessScenario.fixture.js";
import { runAgentRuntime, runContextAgent, runDiagnosticsAgent, runMappingAgent } from "./agentRuntime.js";

describe("agent runtime", () => {
  it("infers room occupancy from HCM presence and motion sensors", () => {
    const context = runContextAgent({
      home: createHarnessScenarioHome(),
      generatedAt: "2026-06-17T12:00:00.000Z",
    });

    expect(context.mode).toBe("shadow");
    expect(context.likelySpace).toMatchObject({
      id: "study",
      occupied: true,
      confidence: 0.92,
    });
    expect(context.spaces.find((space) => space.id === "entry")).toMatchObject({
      occupied: true,
      confidence: 0.64,
    });
  });

  it("creates shadow mapping candidates from unresolved HCM bindings", () => {
    const mapping = runMappingAgent({
      home: createHarnessScenarioHome(),
      generatedAt: "2026-06-17T12:00:00.000Z",
    });

    expect(mapping.mode).toBe("shadow");
    expect(mapping.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          thingName: "猫猫监控",
          proposedAction: "protect",
        }),
        expect.objectContaining({
          thingName: "燃气热水器",
          proposedAction: "protect",
        }),
      ]),
    );
  });

  it("diagnoses recent command failures without mutating execution policy", () => {
    const diagnostics = runDiagnosticsAgent({
      home: createHarnessScenarioHome(),
      auditEntries: [
        {
          commandId: "cmd_1",
          input: "打开燃气热水器",
          status: "rejected",
          execution: { simulation: { rejectedCount: 1 } },
          latencyMs: 2300,
        },
      ],
      generatedAt: "2026-06-17T12:00:00.000Z",
    });

    expect(diagnostics.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "recent_command_failures" }),
        expect.objectContaining({ id: "service_simulation_rejections" }),
        expect.objectContaining({ id: "latency_budget" }),
      ]),
    );
  });

  it("combines all v0.9 agents into a shadow runtime snapshot", () => {
    const snapshot = runAgentRuntime({
      home: createHarnessScenarioHome(),
      auditEntries: [],
      generatedAt: "2026-06-17T12:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      version: "0.1",
      mode: "shadow",
      summary: {
        agentCount: 3,
      },
      agents: {
        context: { id: "context_agent" },
        mapping: { id: "mapping_agent" },
        diagnostics: { id: "diagnostics_agent" },
      },
    });
  });
});
