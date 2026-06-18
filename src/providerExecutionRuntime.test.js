import { describe, expect, it, vi } from "vitest";
import { createProviderAdapterTemplate } from "./adapters/providerAdapterTemplate.js";
import { createProviderCommand, createProviderSnapshotEnvelope } from "./adapters/providerAdapterSdk.js";
import { executeSimulatedProviderPlan, simulateProviderExecutionPlan } from "./providerExecutionRuntime.js";

function fixtureAdapter() {
  const execute = vi.fn(async () => ({ status: "executed" }));
  return {
    execute,
    adapter: createProviderAdapterTemplate({
      provider: { id: "matter", name: "Matter Fixture", version: "1", transport: "matter" },
      driver: {
        discoverSnapshot: async () => createProviderSnapshotEnvelope({
          provider: { id: "matter", name: "Matter Fixture", version: "1", transport: "matter" },
        }),
        discoverHcmHome: async () => ({ provider: { id: "matter" }, spaces: [], things: [] }),
        readState: async () => ({ on: false }),
        compileAction: async (action) => createProviderCommand({
          providerId: "matter",
          target: { id: action.deviceId, type: "device" },
          operation: "on_off.on",
          payload: { value: action.value },
        }),
        simulate: async () => ({ ok: true, code: "supported", message: "fixture accepts command" }),
        execute,
      },
    }),
  };
}

describe("provider execution runtime", () => {
  it("compiles and simulates a non-HA HCM action without executing it", async () => {
    const { adapter, execute } = fixtureAdapter();
    const simulation = await simulateProviderExecutionPlan({
      adapter,
      home: { provider: { id: "matter" } },
      accepted: [{
        thing: { id: "matter_light", name: "Matter 灯" },
        capability: { id: "turn_on", name: "打开" },
        action: { thingId: "matter_light", value: true },
      }],
    });

    expect(simulation).toMatchObject({
      ok: true,
      providerId: "matter",
      checks: [expect.objectContaining({ service: "on_off.on", commandFingerprint: expect.any(String) })],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes exactly the command bound to the successful simulation", async () => {
    const { adapter, execute } = fixtureAdapter();
    const simulation = await simulateProviderExecutionPlan({
      adapter,
      accepted: [{
        thing: { id: "matter_light", name: "Matter 灯" },
        capability: { id: "turn_on", name: "打开" },
        action: { thingId: "matter_light", value: true },
      }],
    });
    const results = await executeSimulatedProviderPlan({ adapter, simulation, commandId: "cmd-1" });

    expect(results).toEqual([expect.objectContaining({ ok: true, providerId: "matter", service: "on_off.on" })]);
    expect(execute).toHaveBeenCalledOnce();
  });
});
