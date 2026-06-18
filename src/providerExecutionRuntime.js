export async function simulateProviderExecutionPlan({ adapter, accepted = [], home } = {}) {
  if (!adapter) throw new Error("provider adapter is required");
  const checks = [];

  for (const item of accepted) {
    try {
      const command = await adapter.compileAction({
        deviceId: item.action?.targetId ?? item.action?.thingId,
        entityId: item.action?.entityId,
        thingId: item.thing?.id,
        capability: item.capability?.id,
        capabilityId: item.capability?.id,
        value: item.action?.value,
        serviceCall: item.serviceCall,
        evidence: item.capability?.evidence,
      });
      const simulation = await adapter.simulate(command, { home, item });
      checks.push({
        ...simulation,
        thingId: item.thing?.id,
        thingName: item.thing?.name,
        capabilityId: item.capability?.id,
        capabilityName: item.capability?.name,
        service: command.operation,
        command,
        action: item.action,
      });
    } catch (error) {
      checks.push({
        ok: false,
        code: "provider_compile_failed",
        message: error.message,
        thingId: item.thing?.id,
        thingName: item.thing?.name,
        capabilityId: item.capability?.id,
        capabilityName: item.capability?.name,
        action: item.action,
      });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    providerId: adapter.id,
    checks,
    rejected: checks.filter((check) => !check.ok).map((check) => ({
      ok: false,
      code: check.code,
      message: check.message,
      thingId: check.thingId,
      thingName: check.thingName,
      capabilityId: check.capabilityId,
      capabilityName: check.capabilityName,
      action: check.action,
      service: check.service,
    })),
  };
}

export async function executeSimulatedProviderPlan({ adapter, simulation, commandId } = {}) {
  if (!adapter) throw new Error("provider adapter is required");
  if (!commandId) throw new Error("commandId is required");
  const results = [];

  for (const check of simulation?.checks ?? []) {
    if (!check.ok || !check.command) continue;
    try {
      const result = await adapter.execute(check.command, {
        authorized: true,
        commandId,
        simulation: check,
      });
      results.push({
        ok: true,
        thingId: check.thingId,
        thingName: check.thingName,
        capabilityId: check.capabilityId,
        capabilityName: check.capabilityName,
        providerId: check.command.providerId,
        service: check.command.operation,
        serviceData: check.command.payload,
        simulation: summarizeSimulation(check),
        result,
      });
    } catch (error) {
      results.push({
        ok: false,
        thingId: check.thingId,
        thingName: check.thingName,
        capabilityId: check.capabilityId,
        capabilityName: check.capabilityName,
        providerId: check.command.providerId,
        service: check.command.operation,
        serviceData: check.command.payload,
        error: error.message,
      });
    }
  }
  return results;
}

function summarizeSimulation(check) {
  return {
    ok: check.ok,
    code: check.code,
    message: check.message,
    commandFingerprint: check.commandFingerprint,
  };
}
