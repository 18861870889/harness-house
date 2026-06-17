import express from "express";
import { createServer as createViteServer } from "vite";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { HOME_ASSISTANT_ADAPTER_ID, createHomeAssistantAdapter } from "./src/adapters/homeAssistantAdapter.js";
import { runAgentRuntime } from "./src/agentRuntime.js";
import {
  applyDefaultRunPolicy,
  applyHcmOverlay,
  createHcmOverlay,
  setBindingReviewDecision,
  setThingOverride,
} from "./src/hcmOverlay.js";
import { buildHcmExecutionPlan } from "./src/hcmExecutor.js";
import { simulateHcmServiceCalls } from "./src/homeAssistantServiceSimulator.js";
import {
  buildHcmPlannerSystemPrompt,
  compileHcmForPlanner,
  normalizeHcmPlannerDraft,
} from "./src/hcmPlanner.js";
import { explainIntentResult } from "./src/intentExplainer.js";
import {
  applyPersonalSemanticsToThingAliases,
  compilePersonalSemanticsForPlanner,
} from "./src/personalSemantics.js";
import { createCommandTrace, finishCommandTrace, runCommandStage } from "./src/commandRuntime.js";
import {
  createLearningMemory,
  deleteLearningCandidate,
  recordLearningObservation,
  summarizeLearningMemory,
  updateLearningCandidate,
} from "./src/learningLayer.js";

const app = express();
loadLocalEnv();
const port = getCliPort() ?? Number(process.env.PORT ?? 5173);
const hcmOverlayPath = resolve(process.cwd(), process.env.HARNESS_HCM_OVERLAY_PATH || "data/home-model-overlay.local.json");
const commandAuditPath = resolve(process.cwd(), process.env.HARNESS_COMMAND_AUDIT_PATH || "data/command-audit.local.jsonl");
const learningMemoryPath = resolve(process.cwd(), process.env.HARNESS_LEARNING_MEMORY_PATH || "data/learning-memory.local.json");
const homeAssistantAdapter = createHomeAssistantAdapter({
  baseUrl: process.env.HA_BASE_URL || process.env.HOME_ASSISTANT_URL,
  token: process.env.HA_TOKEN || process.env.HOME_ASSISTANT_TOKEN,
});

app.use(express.json({ limit: "256kb" }));

app.get("/api/llm/status", (_request, response) => {
  response.json({
    configured: Boolean(process.env.OPENAI_API_KEY),
    provider: process.env.OPENAI_BASE_URL ? "openai-compatible" : "openai",
    model: getModel(),
    mode: process.env.OPENAI_API_KEY ? "real" : "simulated",
  });
});

app.post("/api/llm/plan", async (request, response) => {
  if (!process.env.OPENAI_API_KEY) {
    response.status(503).json({
      error: "OPENAI_API_KEY is not configured; frontend should use LLM Sim fallback.",
    });
    return;
  }

  const startedAt = Date.now();

  try {
    const payload = request.body ?? {};
    validatePlanRequest(payload);
    const draft = await callPlannerModel(payload);
    response.json({
      ...draft,
      provider_latency_ms: Date.now() - startedAt,
      model: getModel(),
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || "LLM planning failed",
    });
  }
});

app.get("/api/adapters/home-assistant/status", (_request, response) => {
  response.json(homeAssistantAdapter.getStatus());
});

app.get("/api/adapters/home-assistant/entities", async (_request, response) => {
  if (!homeAssistantAdapter.isConfigured()) {
    response.status(503).json({
      error: "Home Assistant adapter is not configured. Set HA_BASE_URL and HA_TOKEN.",
    });
    return;
  }

  try {
    const entities = await homeAssistantAdapter.discoverEntities();
    response.json({
      adapter: homeAssistantAdapter.id,
      count: entities.length,
      entities,
    });
  } catch (error) {
    response.status(502).json({
      error: error.message || "Home Assistant discovery failed",
    });
  }
});

app.get("/api/hcm/home", async (_request, response) => {
  if (!homeAssistantAdapter.isConfigured()) {
    response.status(503).json({
      error: "Home Assistant adapter is not configured. Set HA_BASE_URL and HA_TOKEN.",
    });
    return;
  }

  try {
    const home = await homeAssistantAdapter.discoverHcmHome();
    response.json(applyHcmOverlay(home, readHcmOverlay()));
  } catch (error) {
    response.status(502).json({
      error: error.message || "Home Capability Model sync failed",
    });
  }
});

app.get("/api/hcm/overrides", (_request, response) => {
  response.json(readHcmOverlay());
});

app.post("/api/hcm/overrides/bindings", (request, response) => {
  try {
    const payload = request.body ?? {};
    validateBindingOverrideRequest(payload);
    const overlay = setBindingReviewDecision(readHcmOverlay(), {
      providerId: payload.providerId || HOME_ASSISTANT_ADAPTER_ID,
      entityId: payload.entityId,
      action: payload.action,
    });
    writeHcmOverlay(overlay);
    response.json(overlay);
  } catch (error) {
    response.status(error.statusCode || 400).json({
      error: error.message || "HCM override update failed",
    });
  }
});

app.post("/api/hcm/overrides/things", (request, response) => {
  try {
    const payload = request.body ?? {};
    validateThingOverrideRequest(payload);
    const overlay = setThingOverride(readHcmOverlay(), {
      providerId: payload.providerId || HOME_ASSISTANT_ADAPTER_ID,
      thingId: payload.thingId,
      patch: payload.patch,
    });
    writeHcmOverlay(overlay);
    response.json(overlay);
  } catch (error) {
    response.status(error.statusCode || 400).json({
      error: error.message || "HCM thing override update failed",
    });
  }
});

app.post("/api/hcm/overrides/default-run", async (request, response) => {
  if (!homeAssistantAdapter.isConfigured()) {
    response.status(503).json({
      error: "Home Assistant adapter is not configured. Set HA_BASE_URL and HA_TOKEN.",
    });
    return;
  }

  try {
    const payload = request.body ?? {};
    validateDefaultRunRequest(payload);
    const home = await homeAssistantAdapter.discoverHcmHome();
    const { overlay, summary } = applyDefaultRunPolicy(readHcmOverlay(), home, {
      providerId: payload.providerId || home.provider?.id || HOME_ASSISTANT_ADAPTER_ID,
    });
    writeHcmOverlay(overlay);
    response.json({
      summary,
      home: applyHcmOverlay(home, overlay),
    });
  } catch (error) {
    response.status(error.statusCode || 400).json({
      error: error.message || "HCM default-run update failed",
    });
  }
});

app.post("/api/hcm/command", async (request, response) => {
  try {
    const payload = request.body ?? {};
    validateHcmCommandRequest(payload);
    response.json(await runHcmCommandPipeline(payload));
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: error.message || "HCM command failed",
    });
  }
});

app.get("/api/agents/snapshot", async (_request, response) => {
  if (!homeAssistantAdapter.isConfigured()) {
    response.status(503).json({
      error: "Home Assistant adapter is not configured. Set HA_BASE_URL and HA_TOKEN.",
    });
    return;
  }

  try {
    response.json(await buildAgentSnapshot());
  } catch (error) {
    response.status(502).json({
      error: error.message || "Agent snapshot failed",
    });
  }
});

app.get("/api/commands/audit", (request, response) => {
  const limit = Math.max(1, Math.min(100, Number(request.query.limit ?? 20)));
  response.json({
    entries: readCommandAuditEntries(limit),
  });
});

app.post("/api/commands/replay", async (request, response) => {
  try {
    const payload = request.body ?? {};
    validateReplayRequest(payload);
    const entry = readCommandAuditEntries(200).find((item) => item.commandId === payload.commandId);
    if (!entry) {
      response.status(404).json({ error: "Command audit entry not found" });
      return;
    }
    const replayResponse = await runHcmCommandPipeline({
      input: entry.input,
      currentRoomId: payload.currentRoomId,
      selectedRoomId: payload.selectedRoomId,
      dryRun: true,
      replayOf: entry.commandId,
    });
    response.json(replayResponse);
  } catch (error) {
    response.status(error.statusCode || 502).json({
      error: error.message || "Command replay failed",
    });
  }
});

app.get("/api/learning/memory", (_request, response) => {
  response.json(summarizeLearningMemory(readLearningMemory()));
});

app.patch("/api/learning/candidates/:candidateId", (request, response) => {
  try {
    const memory = updateLearningCandidate(readLearningMemory(), request.params.candidateId, request.body ?? {});
    writeLearningMemory(memory);
    response.json(summarizeLearningMemory(memory));
  } catch (error) {
    response.status(error.statusCode || 400).json({
      error: error.message || "Learning candidate update failed",
    });
  }
});

app.delete("/api/learning/candidates/:candidateId", (request, response) => {
  try {
    const memory = deleteLearningCandidate(readLearningMemory(), request.params.candidateId);
    writeLearningMemory(memory);
    response.json(summarizeLearningMemory(memory));
  } catch (error) {
    response.status(error.statusCode || 400).json({
      error: error.message || "Learning candidate delete failed",
    });
  }
});

app.post("/api/adapters/home-assistant/actions", async (request, response) => {
  if (!homeAssistantAdapter.isConfigured()) {
    response.status(503).json({
      error: "Home Assistant adapter is not configured. Set HA_BASE_URL and HA_TOKEN.",
    });
    return;
  }

  try {
    const payload = request.body ?? {};
    validateHomeAssistantActionRequest(payload);
    const result = await homeAssistantAdapter.executeAction(payload);
    response.json(result);
  } catch (error) {
    response.status(error.statusCode || 400).json({
      error: error.message || "Home Assistant action failed",
    });
  }
});

const vite = await createViteServer({
  server: {
    middlewareMode: true,
  },
  appType: "spa",
});

app.use(vite.middlewares);

app.listen(port, "0.0.0.0", () => {
  console.log(`Harness House running at http://localhost:${port}/`);
  console.log(
    process.env.OPENAI_API_KEY
      ? `LLM Gateway enabled with model ${getModel()}`
      : "LLM Gateway running in simulated fallback mode. Set OPENAI_API_KEY to enable real model calls.",
  );
});

function getCliPort() {
  const args = process.argv.slice(2);
  const portFlag = args.findIndex((arg) => arg === "--port" || arg === "-p");
  if (portFlag >= 0 && args[portFlag + 1]) return Number(args[portFlag + 1]);
  const inline = args.find((arg) => arg.startsWith("--port="));
  if (inline) return Number(inline.split("=")[1]);
  return undefined;
}

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function getModel() {
  return process.env.OPENAI_MODEL || process.env.HARNESS_LLM_MODEL || "gpt-4o-mini";
}

function getBaseUrl() {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

function validatePlanRequest(payload) {
  if (!payload || typeof payload !== "object") throw badRequest("Invalid JSON body");
  if (typeof payload.input !== "string" || !payload.input.trim()) {
    throw badRequest("input is required");
  }
  if (!Array.isArray(payload.devices) || payload.devices.length === 0) {
    throw badRequest("devices are required");
  }
}

function validateHomeAssistantActionRequest(payload) {
  if (!payload || typeof payload !== "object") throw badRequest("Invalid JSON body");
  if (typeof payload.entityId !== "string" || !payload.entityId.trim()) {
    throw badRequest("entityId is required");
  }
  if (typeof payload.capability !== "string" || !payload.capability.trim()) {
    throw badRequest("capability is required");
  }
}

function validateBindingOverrideRequest(payload) {
  if (!payload || typeof payload !== "object") throw badRequest("Invalid JSON body");
  if (typeof payload.entityId !== "string" || !payload.entityId.trim()) {
    throw badRequest("entityId is required");
  }
  if (typeof payload.action !== "string" || !payload.action.trim()) {
    throw badRequest("action is required");
  }
  if (payload.providerId !== undefined && typeof payload.providerId !== "string") {
    throw badRequest("providerId must be a string");
  }
}

function validateDefaultRunRequest(payload) {
  if (!payload || typeof payload !== "object") throw badRequest("Invalid JSON body");
  if (payload.providerId !== undefined && typeof payload.providerId !== "string") {
    throw badRequest("providerId must be a string");
  }
}

function validateThingOverrideRequest(payload) {
  if (!payload || typeof payload !== "object") throw badRequest("Invalid JSON body");
  if (typeof payload.thingId !== "string" || !payload.thingId.trim()) {
    throw badRequest("thingId is required");
  }
  if (!payload.patch || typeof payload.patch !== "object" || Array.isArray(payload.patch)) {
    throw badRequest("patch is required");
  }
  if (payload.providerId !== undefined && typeof payload.providerId !== "string") {
    throw badRequest("providerId must be a string");
  }
}

function validateHcmCommandRequest(payload) {
  if (!payload || typeof payload !== "object") throw badRequest("Invalid JSON body");
  if (typeof payload.input !== "string" || !payload.input.trim()) {
    throw badRequest("input is required");
  }
  if (payload.currentRoomId !== undefined && typeof payload.currentRoomId !== "string") {
    throw badRequest("currentRoomId must be a string");
  }
  if (payload.selectedRoomId !== undefined && typeof payload.selectedRoomId !== "string") {
    throw badRequest("selectedRoomId must be a string");
  }
  if (payload.dryRun !== undefined && typeof payload.dryRun !== "boolean") {
    throw badRequest("dryRun must be a boolean");
  }
  if (payload.replayOf !== undefined && typeof payload.replayOf !== "string") {
    throw badRequest("replayOf must be a string");
  }
}

function validateReplayRequest(payload) {
  if (!payload || typeof payload !== "object") throw badRequest("Invalid JSON body");
  if (typeof payload.commandId !== "string" || !payload.commandId.trim()) {
    throw badRequest("commandId is required");
  }
  if (payload.currentRoomId !== undefined && typeof payload.currentRoomId !== "string") {
    throw badRequest("currentRoomId must be a string");
  }
  if (payload.selectedRoomId !== undefined && typeof payload.selectedRoomId !== "string") {
    throw badRequest("selectedRoomId must be a string");
  }
}

function readHcmOverlay() {
  if (!existsSync(hcmOverlayPath)) return createHcmOverlay();
  try {
    return JSON.parse(readFileSync(hcmOverlayPath, "utf8"));
  } catch (error) {
    throw new Error(`HCM overlay file is invalid JSON: ${error.message}`);
  }
}

function writeHcmOverlay(overlay) {
  mkdirSync(dirname(hcmOverlayPath), { recursive: true });
  writeFileSync(hcmOverlayPath, `${JSON.stringify(overlay, null, 2)}\n`);
}

function writeCommandAuditEntry(entry) {
  mkdirSync(dirname(commandAuditPath), { recursive: true });
  appendFileSync(commandAuditPath, `${JSON.stringify(entry)}\n`);
}

function readCommandAuditEntries(limit = 20) {
  if (!existsSync(commandAuditPath)) return [];
  return readFileSync(commandAuditPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .map((line) => JSON.parse(line));
}

function readLearningMemory() {
  if (!existsSync(learningMemoryPath)) return createLearningMemory();
  try {
    return JSON.parse(readFileSync(learningMemoryPath, "utf8"));
  } catch (error) {
    throw new Error(`Learning memory file is invalid JSON: ${error.message}`);
  }
}

function writeLearningMemory(memory) {
  mkdirSync(dirname(learningMemoryPath), { recursive: true });
  writeFileSync(learningMemoryPath, `${JSON.stringify(memory, null, 2)}\n`);
}

function updateLearningMemory(auditEntry) {
  const memory = recordLearningObservation(readLearningMemory(), auditEntry);
  writeLearningMemory(memory);
}

async function runHcmCommandPipeline(payload) {
  if (!homeAssistantAdapter.isConfigured()) {
    const error = new Error("Home Assistant adapter is not configured. Set HA_BASE_URL and HA_TOKEN.");
    error.statusCode = 503;
    throw error;
  }
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY is not configured; real HCM command execution requires a planner model.");
    error.statusCode = 503;
    throw error;
  }

  const trace = createCommandTrace({
    input: payload.input,
    path: "hcm-real",
    dryRun: Boolean(payload.dryRun),
    replayOf: payload.replayOf,
  });

  try {
    const rawHome = await runCommandStage(trace, "context_snapshot", () => homeAssistantAdapter.discoverHcmHome(), {
      summarize: (home) => ({ things: home.stats?.thingCount, capabilities: home.stats?.capabilityCount }),
    });
    const home = await runCommandStage(trace, "policy_overlay", async () => applyPersonalSemanticsToThingAliases(applyHcmOverlay(rawHome, readHcmOverlay())), {
      summarize: (home) => ({
        autoExecutable: home.stats.autoExecutableCapabilities,
        protected: home.stats.unresolvedBindingCount,
      }),
    });
    const personalSemantics = await runCommandStage(
      trace,
      "personal_semantics",
      async () => compilePersonalSemanticsForPlanner(payload.input, home),
      {
        summarize: (hints) => ({
          hints: hints.length,
          phrases: hints.map((hint) => hint.phrase).slice(0, 4),
        }),
      },
    );
    const plannerDevices = await runCommandStage(
      trace,
      "prompt_compile",
      async () =>
        compileHcmForPlanner(home, {
          currentRoomId: payload.currentRoomId,
          selectedRoomId: payload.selectedRoomId,
        }),
      {
        summarize: (devices) => ({
          devices: devices.length,
          capabilities: devices.reduce((sum, device) => sum + device.capabilities.length, 0),
        }),
      },
    );
    if (plannerDevices.length === 0) {
      const error = new Error("No auto-executable HCM capabilities are available.");
      error.statusCode = 409;
      throw error;
    }

    const draft = await runCommandStage(
      trace,
      "llm_planner",
      () =>
        callHcmPlannerModel({
          input: payload.input,
          currentRoomId: payload.currentRoomId,
          selectedRoomId: payload.selectedRoomId,
          devices: plannerDevices,
          personalSemantics,
        }),
      { summarize: (draft) => ({ intent: draft.intent, intentType: draft.intent_type, actionCount: draft.actions?.length ?? 0 }) },
    );
    const plan = await runCommandStage(trace, "plan_normalize", async () => normalizeHcmPlannerDraft(payload.input, draft, home), {
      summarize: (plan) => ({
        intent: plan.intent,
        intentType: plan.intentType,
        actionCount: plan.actions.length,
        stateQuery: plan.stateQuery?.thingName,
        needsConfirmation: plan.needsConfirmation,
      }),
    });
    const executionPlan = await runCommandStage(trace, "safety_gate", async () => buildHcmExecutionPlan(plan.actions, home), {
      summarize: (executionPlan) => ({ accepted: executionPlan.accepted.length, rejected: executionPlan.rejected.length }),
    });
    const serviceSimulation = await runCommandStage(
      trace,
      "ha_service_simulator",
      async () => simulateHcmServiceCalls(executionPlan.accepted, home),
      {
        summarize: (simulation) => ({
          ok: simulation.checks.filter((check) => check.ok).length,
          rejected: simulation.rejected.length,
          assumed: simulation.checks.filter((check) => check.code === "assumed_supported").length,
        }),
      },
    );
    const execution = {
      status: "planned",
      dryRun: Boolean(payload.dryRun),
      accepted: executionPlan.accepted.map((item) => formatAcceptedExecution(item, serviceSimulation)),
      rejected: [...executionPlan.rejected, ...serviceSimulation.rejected],
      simulation: serviceSimulation,
      results: [],
    };

    if (plan.kind === "hcm_state_query") {
      execution.status = "answered";
    } else if (plan.actions.length === 0) {
      execution.status = "no_action";
    } else if (plan.needsConfirmation) {
      execution.status = "needs_confirmation";
    } else if (!executionPlan.ok) {
      execution.status = "rejected";
    } else if (!serviceSimulation.ok) {
      execution.status = "rejected";
    } else if (payload.dryRun) {
      execution.status = "dry_run";
    } else {
      execution.status = "executing";
      execution.results = await runCommandStage(trace, "device_executor", () => executeHcmServiceCalls(executionPlan.accepted), {
        summarize: (results) => ({
          ok: results.filter((result) => result.ok).length,
          failed: results.filter((result) => !result.ok).length,
        }),
      });
      execution.status = execution.results.every((result) => result.ok) ? "executed" : "partial_failure";
    }

    const explanation = explainIntentResult({
      input: payload.input,
      plan,
      execution,
      plannerHints: personalSemantics,
    });
    const agents = runAgentRuntime({
      home,
      auditEntries: readCommandAuditEntries(20),
    });

    const planner = {
      deviceCount: plannerDevices.length,
      capabilityCount: plannerDevices.reduce((sum, device) => sum + device.capabilities.length, 0),
      personalSemanticHintCount: personalSemantics.length,
    };
    const auditEntry = finishCommandTrace(trace, {
      status: execution.status,
      plan,
      execution,
      explanation,
      agents,
      model: getModel(),
      planner,
    });
    writeCommandAuditEntry(auditEntry);
    updateLearningMemory(auditEntry);

    return {
      commandId: trace.commandId,
      replayOf: payload.replayOf,
      status: execution.status,
      latencyMs: auditEntry.latencyMs,
      model: getModel(),
      plan,
      execution,
      planner,
      resolution: plan.resolution,
      explanation,
      agents,
      trace: auditEntry,
    };
  } catch (error) {
    const auditEntry = finishCommandTrace(trace, { status: "error", model: getModel() });
    writeCommandAuditEntry({ ...auditEntry, error: error.message });
    throw error;
  }
}

async function buildAgentSnapshot() {
  const home = applyPersonalSemanticsToThingAliases(applyHcmOverlay(await homeAssistantAdapter.discoverHcmHome(), readHcmOverlay()));
  return runAgentRuntime({
    home,
    auditEntries: readCommandAuditEntries(20),
  });
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

async function callPlannerModel(payload) {
  const response = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getModel(),
      temperature: 0,
      max_tokens: 500,
      response_format: { type: "json_object" },
      ...getProviderOptions(),
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify({
            input: payload.input,
            currentRoomId: payload.currentRoomId,
            selectedRoomId: payload.selectedRoomId,
            devices: payload.devices,
          }),
        },
      ],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Model provider error ${response.status}: ${text.slice(0, 500)}`);
    error.statusCode = 502;
    throw error;
  }

  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model returned no content");

  const draft = parseJsonContent(content);
  validatePlannerDraft(draft);
  return draft;
}

async function callHcmPlannerModel(payload) {
  const response = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getModel(),
      temperature: 0,
      max_tokens: 700,
      response_format: { type: "json_object" },
      ...getProviderOptions(),
      messages: [
        {
          role: "system",
          content: buildHcmPlannerSystemPrompt(),
        },
        {
          role: "user",
          content: JSON.stringify({
            input: payload.input,
            currentRoomId: payload.currentRoomId,
            selectedRoomId: payload.selectedRoomId,
            devices: payload.devices,
            personal_semantics: payload.personalSemantics ?? [],
          }),
        },
      ],
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Model provider error ${response.status}: ${text.slice(0, 500)}`);
    error.statusCode = 502;
    throw error;
  }

  const data = JSON.parse(text);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model returned no content");
  const draft = parseJsonContent(content);
  validatePlannerDraft(draft);
  return draft;
}

async function executeHcmServiceCalls(accepted) {
  const results = [];
  for (const item of accepted) {
    try {
      const result = await homeAssistantAdapter.executeServiceCall(item.serviceCall);
      results.push({
        ok: true,
        thingId: item.thing.id,
        thingName: item.thing.name,
        capabilityId: item.capability.id,
        capabilityName: item.capability.name,
        service: `${item.serviceCall.domain}.${item.serviceCall.service}`,
        serviceData: item.serviceCall.serviceData,
        result,
      });
    } catch (error) {
      results.push({
        ok: false,
        thingId: item.thing.id,
        thingName: item.thing.name,
        capabilityId: item.capability.id,
        capabilityName: item.capability.name,
        service: `${item.serviceCall.domain}.${item.serviceCall.service}`,
        serviceData: item.serviceCall.serviceData,
        error: error.message,
      });
    }
  }
  return results;
}

function formatAcceptedExecution(item, simulation) {
  const service = `${item.serviceCall.domain}.${item.serviceCall.service}`;
  const check = simulation?.checks?.find((candidate) => candidate.service === service && candidate.thingId === item.thing.id);
  return {
    thingId: item.thing.id,
    thingName: item.thing.name,
    capabilityId: item.capability.id,
    capabilityName: item.capability.name,
    value: item.action.value,
    service,
    serviceData: item.serviceCall.serviceData,
    simulation: check
      ? {
          ok: check.ok,
          code: check.code,
          message: check.message,
        }
      : null,
  };
}

function getProviderOptions() {
  if (!getBaseUrl().includes("deepseek.com")) return {};
  return {
    thinking: { type: "disabled" },
  };
}

function buildSystemPrompt() {
  return [
    "You are Harness House Hermes Gateway, a smart-home planning agent.",
    "Convert the user's Chinese smart-home instruction into strict JSON only.",
    "Never execute devices. Never invent devices.",
    "Only use device ids provided in the user JSON.",
    "Only use capabilities explicitly listed on each device. Do not use a capability just because it appears on another device.",
    "Respect capability valueType, min, max, unit, risk, and confirmation fields.",
    "High, sensitive, or confirmation=always capabilities must set needs_confirmation=true.",
    "Prefer small plans. For ambiguous instructions, use currentRoomId and selectedRoomId.",
    "Return exactly this JSON shape:",
    '{"intent":"string","confidence":0.0,"summary":"中文短句","needs_confirmation":false,"actions":[{"device_id":"string","capability":"string","value":true,"reason":"中文短句"}]}',
  ].join("\n");
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Model did not return JSON");
    return JSON.parse(match[0]);
  }
}

function validatePlannerDraft(draft) {
  if (!draft || typeof draft !== "object") throw new Error("Planner draft must be an object");
  if (!Array.isArray(draft.actions)) throw new Error("Planner draft actions must be an array");
  if (typeof draft.summary !== "string") draft.summary = "已生成真实大模型计划。";
  if (typeof draft.intent !== "string") draft.intent = "llm_control";
  if (typeof draft.confidence !== "number") draft.confidence = 0.6;
  if (typeof draft.needs_confirmation !== "boolean") draft.needs_confirmation = false;
}
