import { describe, expect, it } from "vitest";
import { createHomeAssistantAdapter, mapHomeAssistantState } from "./homeAssistantAdapter.js";

describe("home assistant adapter", () => {
  it("reports unconfigured status without exposing secrets", () => {
    const adapter = createHomeAssistantAdapter();

    expect(adapter.getStatus()).toEqual({
      configured: false,
      baseUrl: null,
    });
    expect(adapter.isConfigured()).toBe(false);
  });

  it("discovers entities from /api/states and maps capabilities", async () => {
    const adapter = createHomeAssistantAdapter({
      baseUrl: "http://ha.local:8123/",
      token: "secret",
      fetchImpl: async (url, options) => {
        expect(url).toBe("http://ha.local:8123/api/states");
        expect(options.headers.Authorization).toBe("Bearer secret");
        return {
          ok: true,
          async json() {
            return [
              {
                entity_id: "light.living_room",
                state: "on",
                attributes: {
                  friendly_name: "客厅灯",
                  brightness: 128,
                },
              },
              {
                entity_id: "cover.balcony_drying_rack",
                state: "open",
                attributes: {
                  friendly_name: "阳台晾衣杆",
                  current_position: 70,
                },
              },
            ];
          },
        };
      },
    });

    const entities = await adapter.discoverEntities();

    expect(entities).toHaveLength(2);
    expect(entities[0]).toMatchObject({
      entityId: "light.living_room",
      suggestedDevice: {
        type: "light",
        roomId: "living",
        on: true,
      },
    });
    expect(entities[0].manifest.capabilities).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "set_brightness", max: 100 })]),
    );
    expect(entities[1]).toMatchObject({
      suggestedDevice: {
        type: "drying_rack",
        roomId: "balcony",
        position: 70,
      },
    });
  });

  it("maps binary sensors to sensitive read-only device manifests", () => {
    const mapped = mapHomeAssistantState({
      entity_id: "binary_sensor.front_door",
      state: "on",
      attributes: {
        friendly_name: "入户门",
        device_class: "door",
      },
    });

    expect(mapped.suggestedDevice).toMatchObject({
      type: "door_sensor",
      risk: "sensitive",
      open: true,
    });
    expect(mapped.manifest.capabilities).toEqual([]);
  });

  it("throws when discovery is requested without configuration", async () => {
    const adapter = createHomeAssistantAdapter();

    await expect(adapter.discoverEntities()).rejects.toThrow("not configured");
  });
});
