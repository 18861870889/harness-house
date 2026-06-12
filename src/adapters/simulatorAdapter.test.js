import { describe, expect, it } from "vitest";
import { executePlan, executeStep, tick } from "./simulatorAdapter.js";
import { initialDevices, parseCommand } from "../simulator.js";

describe("simulator adapter", () => {
  it("executes a validated plan against in-memory devices", () => {
    const devices = structuredClone(initialDevices);
    const plan = parseCommand("关客厅灯", devices, {
      currentRoomId: "living",
      selectedRoomId: "living",
    });

    const result = executePlan(plan, devices);

    expect(result.devices.living_light.on).toBe(false);
    expect(result.devices.living_light.brightness).toBe(0);
    expect(result.results).toEqual([
      expect.objectContaining({
        status: "executed",
        text: "客厅主灯: 关闭",
      }),
    ]);
  });

  it("returns a failed step result when a device is missing", () => {
    const result = executeStep(
      {
        deviceId: "missing_device",
        deviceName: "不存在的设备",
        capability: "turn_on",
        value: true,
      },
      structuredClone(initialDevices),
    );

    expect(result).toMatchObject({
      status: "failed",
      text: "未找到设备 不存在的设备",
    });
  });

  it("ticks long-running appliances and robot state", () => {
    const devices = structuredClone(initialDevices);
    devices.washer.status = "running";
    devices.washer.minutesLeft = 1;
    devices.robot.status = "cleaning";
    devices.robot.battery = 12;

    const next = tick(devices);

    expect(next.washer.status).toBe("done");
    expect(next.washer.minutesLeft).toBe(0);
    expect(next.robot.status).toBe("docked");
    expect(next.robot.battery).toBe(11);
  });
});
