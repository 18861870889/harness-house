import express from "express";
import { createServer as createViteServer } from "vite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHomeAssistantAdapter } from "./src/adapters/homeAssistantAdapter.js";

const app = express();
loadLocalEnv();
const port = getCliPort() ?? Number(process.env.PORT ?? 5173);
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
