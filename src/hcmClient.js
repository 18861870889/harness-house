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
