export async function getHcmHome() {
  const response = await fetch("/api/hcm/home");
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `HCM request failed ${response.status}`);
  }
  return payload;
}

export async function updateHcmBindingOverride({ providerId, entityId, action }) {
  const response = await fetch("/api/hcm/overrides/bindings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, entityId, action }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `HCM override request failed ${response.status}`);
  }
  return payload;
}

export async function applyDefaultRunPolicy({ providerId } = {}) {
  const response = await fetch("/api/hcm/overrides/default-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `HCM default-run request failed ${response.status}`);
  }
  return payload;
}

export async function runHcmCommand({ input, currentRoomId, selectedRoomId, dryRun = false }) {
  const response = await fetch("/api/hcm/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, currentRoomId, selectedRoomId, dryRun }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `HCM command request failed ${response.status}`);
  }
  return payload;
}

export async function updateHcmThingOverride({ providerId, thingId, patch }) {
  const response = await fetch("/api/hcm/overrides/things", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, thingId, patch }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `HCM thing override request failed ${response.status}`);
  }
  return payload;
}

export async function getCommandAudit({ limit = 8 } = {}) {
  const response = await fetch(`/api/commands/audit?limit=${encodeURIComponent(limit)}`);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `Command audit request failed ${response.status}`);
  }
  return payload;
}

export async function getLearningMemory() {
  const response = await fetch("/api/learning/memory");
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `Learning memory request failed ${response.status}`);
  }
  return payload;
}
