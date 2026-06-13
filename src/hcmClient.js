export async function getHcmHome() {
  const response = await fetch("/api/hcm/home");
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `HCM request failed ${response.status}`);
  }
  return payload;
}
