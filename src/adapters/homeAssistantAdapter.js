import { createDeviceManifest, pickDeviceState } from "../deviceRuntime.js";

export const HOME_ASSISTANT_ADAPTER_ID = "home_assistant";

export function createHomeAssistantAdapter({ baseUrl, token, fetchImpl = fetch } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  return {
    id: HOME_ASSISTANT_ADAPTER_ID,
    isConfigured: () => Boolean(normalizedBaseUrl && token),
    getStatus: () => ({
      configured: Boolean(normalizedBaseUrl && token),
      baseUrl: normalizedBaseUrl ? redactUrl(normalizedBaseUrl) : null,
    }),
    async discoverEntities() {
      if (!normalizedBaseUrl || !token) {
        throw new Error("Home Assistant adapter is not configured");
      }

      const response = await fetchImpl(`${normalizedBaseUrl}/api/states`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Home Assistant states request failed ${response.status}: ${text.slice(0, 300)}`);
      }

      const states = await response.json();
      if (!Array.isArray(states)) throw new Error("Home Assistant /api/states did not return an array");

      return states.map(mapHomeAssistantState).filter(Boolean);
    },
  };
}

export function mapHomeAssistantState(state) {
  const [domain, objectId] = String(state.entity_id ?? "").split(".");
  if (!domain || !objectId) return null;

  const type = mapDomainToType(domain, state);
  const harnessDevice = createHarnessDeviceFromState({ state, domain, objectId, type });

  return {
    entityId: state.entity_id,
    domain,
    name: harnessDevice.name,
    state: state.state,
    attributes: pickSafeAttributes(state.attributes ?? {}),
    suggestedDevice: harnessDevice,
    manifest: createDeviceManifest(harnessDevice, HOME_ASSISTANT_ADAPTER_ID),
  };
}

function createHarnessDeviceFromState({ state, domain, objectId, type }) {
  const attributes = state.attributes ?? {};
  const name = attributes.friendly_name || objectId.replace(/_/g, " ");
  const id = `ha_${state.entity_id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  const base = {
    id,
    name,
    roomId: inferRoomId(name, objectId),
    type,
    risk: inferRisk(type, domain, name),
    online: state.state !== "unavailable" && state.state !== "unknown",
  };

  if (["light", "switch", "fan", "tv", "gas_heater", "camera"].includes(type)) {
    base.on = ["on", "playing"].includes(state.state);
  }
  if (type === "light") base.brightness = Math.round(((attributes.brightness ?? 0) / 255) * 100);
  if (type === "ac") {
    base.on = state.state !== "off";
    base.temperature = Number(attributes.temperature ?? attributes.current_temperature ?? 25);
    base.mode = state.state;
  }
  if (type === "fan") base.speed = state.state === "on" ? 1 : 0;
  if (type === "curtain" || type === "drying_rack") {
    base.position = Number(attributes.current_position ?? (state.state === "open" ? 100 : 0));
  }
  if (type === "robot_vacuum") {
    base.status = state.state === "cleaning" ? "cleaning" : "docked";
    base.battery = Number(attributes.battery_level ?? 100);
  }
  if (type === "washer" || type === "dryer") {
    base.status = state.state === "on" || state.state === "running" ? "running" : "idle";
    base.minutesLeft = 0;
  }
  if (type === "presence_sensor" || type === "motion_sensor") {
    base.detected = ["on", "home", "detected", "motion"].includes(state.state);
  }
  if (type === "door_sensor") base.open = state.state === "on" || state.state === "open";
  if (type === "pet_feeder") {
    base.portionsToday = 0;
    base.lastFeed = "--:--";
  }

  return base;
}

function mapDomainToType(domain, state) {
  const name = `${state.entity_id} ${state.attributes?.friendly_name ?? ""}`.toLowerCase();
  if (domain === "light") return "light";
  if (domain === "fan") return "fan";
  if (domain === "climate") return /water|heater|热水|燃气/.test(name) ? "gas_heater" : "ac";
  if (domain === "cover") return /dry|rack|晾衣|衣杆/.test(name) ? "drying_rack" : "curtain";
  if (domain === "media_player") return "tv";
  if (domain === "vacuum") return "robot_vacuum";
  if (domain === "camera") return "camera";
  if (domain === "switch") return mapSwitchType(name);
  if (domain === "binary_sensor") return mapBinarySensorType(state);
  return "switch";
}

function mapSwitchType(name) {
  if (/washer|洗衣/.test(name)) return "washer";
  if (/dryer|烘干/.test(name)) return "dryer";
  if (/feeder|cat|pet|猫粮|投喂/.test(name)) return "pet_feeder";
  if (/heater|热水|燃气/.test(name)) return "gas_heater";
  return "switch";
}

function mapBinarySensorType(state) {
  const deviceClass = state.attributes?.device_class;
  if (["door", "window", "opening", "garage_door"].includes(deviceClass)) return "door_sensor";
  if (["motion", "occupancy"].includes(deviceClass)) return "motion_sensor";
  if (["presence"].includes(deviceClass)) return "presence_sensor";
  return "presence_sensor";
}

function inferRisk(type, domain, name) {
  if (["gas_heater"].includes(type) || /燃气|gas/.test(name)) return "high";
  if (["camera", "presence_sensor", "motion_sensor", "door_sensor"].includes(type)) return "sensitive";
  if (["washer", "dryer", "robot_vacuum", "pet_feeder", "drying_rack"].includes(type)) return "medium";
  if (domain === "switch" && /heater|热水/.test(name)) return "high";
  return "low";
}

function inferRoomId(name, objectId) {
  const text = `${name} ${objectId}`.toLowerCase();
  if (/entry|玄关|门口/.test(text)) return "entry";
  if (/living|客厅/.test(text)) return "living";
  if (/dining|餐厅/.test(text)) return "dining";
  if (/kitchen|厨房/.test(text)) return "kitchen";
  if (/study|书房/.test(text)) return "study";
  if (/master|主卧/.test(text)) return "master";
  if (/second|次卧/.test(text)) return "second";
  if (/bath|浴室|卫生间/.test(text)) return "bath";
  if (/balcony|阳台/.test(text)) return "balcony";
  return "living";
}

function pickSafeAttributes(attributes) {
  const safe = {};
  for (const key of [
    "friendly_name",
    "device_class",
    "brightness",
    "temperature",
    "current_temperature",
    "current_position",
    "battery_level",
    "supported_features",
  ]) {
    if (key in attributes) safe[key] = attributes[key];
  }
  return safe;
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return null;
  return String(baseUrl).replace(/\/$/, "");
}

function redactUrl(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return baseUrl;
  }
}
