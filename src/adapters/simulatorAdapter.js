export const SIMULATOR_ADAPTER_ID = "simulator";

export function createSimulatorAdapter() {
  return {
    id: SIMULATOR_ADAPTER_ID,
    executePlan,
    executeStep,
    tick,
  };
}

export function executePlan(plan, devices) {
  const next = structuredClone(devices);
  const results = [];

  for (const step of plan.steps) {
    const result = executeStep(step, next);
    results.push(result);
  }

  return {
    devices: next,
    results,
    log: {
      id: crypto.randomUUID(),
      time: now(),
      level: plan.needsConfirmation ? "confirm" : "success",
      text:
        results.length > 0
          ? `执行计划「${plan.intent}」：${results.map((item) => item.text).join("；")}`
          : plan.summary,
    },
  };
}

export function executeStep(step, devices) {
  const device = devices[step.deviceId];
  if (!device) {
    return {
      step,
      status: "failed",
      text: `未找到设备 ${step.deviceName}`,
    };
  }

  applyStep(device, step);
  return {
    step,
    status: "executed",
    text: `${step.deviceName}: ${describeStep(step)}`,
  };
}

export function tick(devices) {
  const next = structuredClone(devices);
  for (const device of Object.values(next)) {
    if (["washer", "dryer"].includes(device.type) && device.status === "running") {
      device.minutesLeft = Math.max(0, device.minutesLeft - 1);
      if (device.minutesLeft === 0) device.status = "done";
    }
    if (device.type === "robot_vacuum" && device.status === "cleaning") {
      device.battery = Math.max(8, device.battery - 1);
      if (device.battery <= 12) device.status = "docked";
    }
  }
  return next;
}

export function describeStep(step) {
  switch (step.capability) {
    case "turn_on":
      return "打开";
    case "turn_off":
      return "关闭";
    case "set_brightness":
      return `亮度 ${step.value}%`;
    case "set_temperature":
      return `${step.value} 度`;
    case "set_speed":
      return `${step.value} 档`;
    case "set_position":
      return `开合 ${step.value}%`;
    case "start_robot":
      return "开始清扫";
    case "dock_robot":
      return "回充";
    case "start_cycle":
      return "开始运行";
    case "stop_cycle":
      return "停止运行";
    case "dispense_food":
      return `投喂 ${step.value} 份`;
    case "set_privacy_mode":
      return step.value ? "开启隐私模式" : "关闭隐私模式";
    default:
      return step.capability;
  }
}

function applyStep(device, step) {
  switch (step.capability) {
    case "turn_on":
      device.on = true;
      if (device.type === "fan") device.speed = Math.max(device.speed ?? 0, 1);
      if (device.type === "light") device.brightness = Math.max(device.brightness ?? 0, 60);
      break;
    case "turn_off":
      device.on = false;
      if (device.type === "fan") device.speed = 0;
      if (device.type === "light") device.brightness = 0;
      break;
    case "set_brightness":
      device.on = step.value > 0;
      device.brightness = step.value;
      break;
    case "set_temperature":
      device.on = true;
      device.temperature = step.value;
      break;
    case "set_speed":
      device.on = step.value > 0;
      device.speed = step.value;
      break;
    case "set_position":
      device.position = step.value;
      break;
    case "start_robot":
      device.status = "cleaning";
      break;
    case "dock_robot":
      device.status = "docked";
      break;
    case "start_cycle":
      device.status = "running";
      device.minutesLeft = device.type === "washer" ? 48 : 35;
      break;
    case "stop_cycle":
      device.status = "idle";
      device.minutesLeft = 0;
      break;
    case "dispense_food":
      device.portionsToday += step.value;
      device.lastFeed = now().slice(0, 5);
      break;
    case "set_privacy_mode":
      device.privacyMode = step.value;
      break;
    default:
      break;
  }
}

function now() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}
