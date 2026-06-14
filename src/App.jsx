import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  Clock3,
  Cpu,
  Gauge,
  Home,
  Layers3,
  LockKeyhole,
  Network,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import ThreeHouse from "./ThreeHouse.jsx";
import { planCommand } from "./commandPipeline.js";
import { getHcmHome, updateHcmBindingOverride } from "./hcmClient.js";
import { getLlmStatus, requestLlmPlan } from "./llmClient.js";
import {
  createInitialLog,
  describeStep,
  deviceTypeNames,
  examples,
  executePlan,
  getRoomName,
  inferCurrentRoom,
  initialDevices,
  rooms,
  summarizeHome,
  tickDevices,
  toggleSensor,
} from "./simulator.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeMessage(role, content, meta = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    ...meta,
  };
}

function latencyClass(latency) {
  if (latency < 800) return "good";
  if (latency < 2000) return "ok";
  return "slow";
}

export default function App() {
  const [devices, setDevices] = useState(() => structuredClone(initialDevices));
  const [input, setInput] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState("study");
  const [messages, setMessages] = useState(() => [
    makeMessage("assistant", "Harness House 本地模拟器已就绪。", {
      path: "system",
      latency: 0,
    }),
  ]);
  const [logs, setLogs] = useState(createInitialLog);
  const [pendingPlan, setPendingPlan] = useState(null);
  const [lastPlan, setLastPlan] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [llmStatus, setLlmStatus] = useState({
    configured: false,
    mode: "simulated",
    model: "simulated",
  });
  const [hcmHome, setHcmHome] = useState(null);
  const [hcmStatus, setHcmStatus] = useState({
    state: "idle",
    error: null,
  });
  const [reviewActionId, setReviewActionId] = useState(null);
  const inputRef = useRef(null);

  const currentRoomId = useMemo(() => inferCurrentRoom(devices), [devices]);
  const selectedRoomDevices = useMemo(
    () => Object.values(devices).filter((device) => device.roomId === selectedRoomId),
    [devices, selectedRoomId],
  );
  const activeDevices = useMemo(
    () =>
      Object.values(devices).filter((device) => {
        if ("on" in device) return device.on;
        if ("detected" in device) return device.detected;
        if (device.type === "robot_vacuum") return device.status === "cleaning";
        if (["washer", "dryer"].includes(device.type)) return device.status === "running";
        return false;
      }),
    [devices],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setDevices((current) => tickDevices(current));
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    getLlmStatus().then(setLlmStatus);
  }, []);

  const refreshHcmHome = useCallback(async () => {
    setHcmStatus({ state: "loading", error: null });
    try {
      const home = await getHcmHome();
      setHcmHome(home);
      setHcmStatus({ state: "ready", error: null });
    } catch (error) {
      setHcmStatus({ state: "error", error: error.message });
    }
  }, []);

  useEffect(() => {
    refreshHcmHome();
  }, [refreshHcmHome]);

  const updateBindingReview = useCallback(
    async (binding, action) => {
      if (!binding?.entityId || reviewActionId) return;
      setReviewActionId(`${binding.id}:${action}`);
      setHcmStatus({ state: "loading", error: null });
      try {
        await updateHcmBindingOverride({
          providerId: hcmHome?.provider?.id,
          entityId: binding.entityId,
          action,
        });
        await refreshHcmHome();
      } catch (error) {
        setHcmStatus({ state: "error", error: error.message });
      } finally {
        setReviewActionId(null);
      }
    },
    [hcmHome?.provider?.id, refreshHcmHome, reviewActionId],
  );

  async function submitCommand(raw = input) {
    const command = raw.trim();
    if (!command || processing) return;

    setInput("");
    setPendingPlan(null);
    setMessages((current) => [...current, makeMessage("user", command)]);
    setProcessing(true);

    const pipeline = await planCommand({
      input: command,
      devices,
      currentRoomId,
      selectedRoomId,
      llmStatus,
      requestRealPlan: requestLlmPlan,
      wait: delay,
    });
    let plan = pipeline.plan;

    if (pipeline.fallbackError) {
      setLogs((current) => [
        {
          id: crypto.randomUUID(),
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          level: "info",
          text: `真实 LLM 不可用，已退回 LLM Sim：${pipeline.fallbackError.message}`,
        },
        ...current,
      ]);
    }

    const latency = pipeline.commandResult.latencyMs;
    setLastPlan(plan);

    if (plan.kind === "empty") {
      setMessages((current) => [...current, makeMessage("assistant", plan.message, { latency })]);
      setProcessing(false);
      return;
    }

    if (plan.needsConfirmation) {
      setPendingPlan(plan);
      setMessages((current) => [
        ...current,
        makeMessage("assistant", `${plan.summary}\n等待确认。`, {
          path: plan.path,
          latency,
          planId: plan.id,
        }),
      ]);
      setLogs((current) => [
        {
          id: crypto.randomUUID(),
          time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
          level: "confirm",
          text: `Safety Gate 拦截「${plan.intent}」，需要确认。`,
        },
        ...current,
      ]);
      setProcessing(false);
      return;
    }

    applyPlan(plan, latency);
    setProcessing(false);
  }

  function applyPlan(plan, latency = 0) {
    const executed = executePlan(plan, devices);
    setDevices(executed.devices);
    setLogs((current) => [executed.log, ...current].slice(0, 40));
    setMessages((current) => [
      ...current,
      makeMessage("assistant", plan.steps.length > 0 ? executed.log.text : plan.summary, {
        path: plan.path,
        latency,
        planId: plan.id,
      }),
    ]);
  }

  function confirmPending() {
    if (!pendingPlan) return;
    const started = performance.now();
    const executed = executePlan(pendingPlan, devices);
    const latency = Math.round(performance.now() - started);
    setDevices(executed.devices);
    setLogs((current) => [
      {
        ...executed.log,
        level: "success",
        text: `用户确认后执行：${executed.log.text}`,
      },
      ...current,
    ]);
    setMessages((current) => [
      ...current,
      makeMessage("assistant", `已确认并执行。\n${executed.log.text}`, {
        path: pendingPlan.path,
        latency,
        planId: pendingPlan.id,
      }),
    ]);
    setPendingPlan(null);
  }

  function cancelPending() {
    if (!pendingPlan) return;
    setLogs((current) => [
      {
        id: crypto.randomUUID(),
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        level: "cancel",
        text: `已取消计划「${pendingPlan.intent}」。`,
      },
      ...current,
    ]);
    setMessages((current) => [...current, makeMessage("assistant", "已取消这次计划。")]);
    setPendingPlan(null);
  }

  function resetDemo() {
    setDevices(structuredClone(initialDevices));
    setPendingPlan(null);
    setLastPlan(null);
    setLogs(createInitialLog());
    setMessages([
      makeMessage("assistant", "Harness House 本地模拟器已重置。", {
        path: "system",
        latency: 0,
      }),
    ]);
  }

  function toggleDeviceSensor(sensorId) {
    setDevices((current) => toggleSensor(current, sensorId));
  }

  const handleSelectRoom = useCallback((roomId) => {
    setSelectedRoomId(roomId);
  }, []);

  return (
    <main className="app">
      <section className="scene-panel" aria-label="三维房屋模拟器">
        <ThreeHouse
          devices={devices}
          selectedRoomId={selectedRoomId}
          onSelectRoom={handleSelectRoom}
        />
      </section>

      <aside className="left-rail">
        <Header currentRoomId={currentRoomId} activeCount={activeDevices.length} llmStatus={llmStatus} />
        <SystemMetrics devices={devices} />
        <HcmCatalog
          home={hcmHome}
          status={hcmStatus}
          onRefresh={refreshHcmHome}
          onReviewAction={updateBindingReview}
          reviewActionId={reviewActionId}
        />
        <RoomSelector selectedRoomId={selectedRoomId} onSelect={setSelectedRoomId} />
        <DeviceList devices={selectedRoomDevices} />
      </aside>

      <aside className="right-rail">
        <CommandConsole
          input={input}
          setInput={setInput}
          inputRef={inputRef}
          messages={messages}
          processing={processing}
          onSubmit={submitCommand}
        />
        <PendingPlan plan={pendingPlan} onConfirm={confirmPending} onCancel={cancelPending} />
        <PlanPreview plan={lastPlan} />
        <SensorSimulator devices={devices} onToggle={toggleDeviceSensor} />
        <AuditLog logs={logs} />
      </aside>

      <div className="bottom-bar">
        <div className="example-strip" aria-label="示例命令">
          {examples.map((example) => (
            <button
              className="example-chip"
              key={example}
              type="button"
              onClick={() => submitCommand(example)}
              disabled={processing}
            >
              <Play size={14} />
              <span>{example}</span>
            </button>
          ))}
        </div>
        <button className="icon-command" type="button" onClick={resetDemo} title="重置本地模拟">
          <RotateCcw size={18} />
        </button>
      </div>
    </main>
  );
}

function Header({ currentRoomId, activeCount, llmStatus }) {
  return (
    <header className="product-header">
      <div className="mark">
        <Home size={22} />
      </div>
      <div>
        <h1>Harness House</h1>
        <p>Local AI Home Runtime</p>
      </div>
      <div className="status-pill">
        <span className="live-dot" />
        Local
      </div>
      <div className="header-facts">
        <Fact icon={Layers3} label="当前区域" value={getRoomName(currentRoomId)} />
        <Fact icon={Power} label="活跃设备" value={`${activeCount}`} />
        <Fact
          icon={Sparkles}
          label="LLM"
          value={llmStatus.configured ? `Real · ${llmStatus.model}` : "Sim fallback"}
        />
      </div>
    </header>
  );
}

function Fact({ icon: Icon, label, value }) {
  return (
    <div className="fact">
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SystemMetrics({ devices }) {
  const summary = useMemo(() => summarizeHome(devices), [devices]);
  const highRisk = devices.gas_heater.on ? "开启" : "关闭";
  const feeder = devices.cat_feeder;
  const robot = devices.robot.status === "cleaning" ? "清扫" : "待命";

  return (
    <section className="panel compact-panel">
      <div className="panel-title">
        <Activity size={17} />
        <h2>House State</h2>
      </div>
      <p className="state-summary">{summary}</p>
      <div className="metric-grid">
        <Metric label="燃气热水器" value={highRisk} tone={devices.gas_heater.on ? "danger" : "muted"} />
        <Metric label="猫粮机" value={`${feeder.portionsToday} 份`} />
        <Metric label="扫地机器人" value={robot} />
        <Metric label="前门" value={devices.front_door.open ? "开启" : "关闭"} />
      </div>
    </section>
  );
}

function Metric({ label, value, tone = "normal" }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HcmCatalog({ home, status, onRefresh, onReviewAction, reviewActionId }) {
  const areaCounts = useMemo(() => {
    if (!home) return [];
    const spaces = new Map(home.spaces.map((space) => [space.id, space.name]));
    const counts = {};
    for (const thing of home.things) {
      const name = spaces.get(thing.spaceId) || thing.spaceId;
      counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [home]);

  const visibleThings = useMemo(() => {
    if (!home) return [];
    return [...home.things]
      .sort((a, b) => (b.state.autoExecutable ?? 0) - (a.state.autoExecutable ?? 0))
      .slice(0, 6);
  }, [home]);

  return (
    <section className="panel hcm-panel">
      <div className="panel-title">
        <Network size={17} />
        <h2>Home Model</h2>
        <button className="mini-icon-button" type="button" onClick={onRefresh} title="同步真实设备">
          <RefreshCw size={14} />
        </button>
      </div>

      {status.state === "loading" && <p className="hcm-note">正在同步真实设备能力...</p>}
      {status.state === "error" && <p className="hcm-error">{status.error}</p>}
      {home && (
        <>
          <div className="hcm-metrics">
            <Metric label="真实设备" value={`${home.stats.thingCount}`} />
            <Metric label="能力" value={`${home.stats.capabilityCount}`} />
            <Metric label="可自动执行" value={`${home.stats.autoExecutableCapabilities}`} />
            <Metric label="待确认绑定" value={`${home.stats.unresolvedBindingCount}`} tone="danger" />
          </div>
          <div className="hcm-area-strip">
            {areaCounts.slice(0, 6).map(([area, count]) => (
              <span key={area}>
                {area} <strong>{count}</strong>
              </span>
            ))}
          </div>
          {home.overlay?.bindingOverrideCount > 0 && (
            <div className="overlay-summary">
              已审核 <strong>{home.overlay.bindingOverrideCount}</strong>
            </div>
          )}
          <BindingReview review={home.review} onAction={onReviewAction} actionId={reviewActionId} />
          <div className="hcm-thing-list">
            {visibleThings.map((thing) => (
              <div className={`hcm-thing risk-${thing.policy.risk}`} key={thing.id}>
                <span>{thing.type}</span>
                <strong>{thing.name}</strong>
                <small>
                  {thing.state.autoExecutable}/{thing.state.controllable} auto
                </small>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function BindingReview({ review, onAction, actionId }) {
  if (!review || review.total === 0) return null;
  const riskItems = Object.entries(review.byRisk ?? {}).sort(([, first], [, second]) => second - first);
  const samples = review.samples ?? [];

  return (
    <div className="binding-review">
      <div className="review-header">
        <span>Review Queue</span>
        <strong>{review.total}</strong>
      </div>
      <div className="review-risk-strip">
        {riskItems.map(([risk, count]) => (
          <span className={`risk-chip risk-${risk}`} key={risk}>
            {risk} <strong>{count}</strong>
          </span>
        ))}
      </div>
      <div className="review-reasons">
        {(review.topReasons ?? []).slice(0, 3).map((item) => (
          <div className="review-reason" key={item.reason}>
            <span>{item.reason}</span>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
      <div className="review-samples">
        {samples.slice(0, 3).map((item) => (
          <div className={`review-sample risk-${item.suggestedRisk}`} key={item.id}>
            <span>{item.thingName}</span>
            <strong>{item.entityName}</strong>
            <small>{item.reason}</small>
            <div className="review-actions">
              <button
                type="button"
                title="允许 AI 自动执行"
                disabled={Boolean(actionId)}
                onClick={() => onAction(item, "allow_auto")}
              >
                <Check size={12} />
                允许
              </button>
              <button
                type="button"
                title="执行前必须确认"
                disabled={Boolean(actionId)}
                onClick={() => onAction(item, "require_confirmation")}
              >
                <ShieldCheck size={12} />
                确认
              </button>
              <button
                type="button"
                title="禁止 AI 自动执行"
                disabled={Boolean(actionId)}
                onClick={() => onAction(item, "block")}
              >
                <X size={12} />
                禁止
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomSelector({ selectedRoomId, onSelect }) {
  return (
    <section className="panel room-panel">
      <div className="panel-title">
        <Home size={17} />
        <h2>Rooms</h2>
      </div>
      <div className="room-grid">
        {rooms.map((room) => (
          <button
            className={room.id === selectedRoomId ? "room-button selected" : "room-button"}
            key={room.id}
            type="button"
            onClick={() => onSelect(room.id)}
          >
            <span>{room.name}</span>
            <small>{room.presence ? "有人" : "待机"}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function DeviceList({ devices }) {
  return (
    <section className="panel device-panel">
      <div className="panel-title">
        <Cpu size={17} />
        <h2>Devices</h2>
      </div>
      <div className="device-list">
        {devices.map((device) => (
          <DeviceRow device={device} key={device.id} />
        ))}
      </div>
    </section>
  );
}

function DeviceRow({ device }) {
  const state = deviceStateLabel(device);
  return (
    <div className={`device-row risk-${device.risk}`}>
      <div className="device-type">{deviceTypeNames[device.type] ?? device.type}</div>
      <div className="device-name">{device.name}</div>
      <div className="device-state">{state}</div>
    </div>
  );
}

function deviceStateLabel(device) {
  if (device.type === "light") return device.on ? `${device.brightness}%` : "关闭";
  if (device.type === "ac") return device.on ? `${device.temperature}°C` : "关闭";
  if (device.type === "fan") return device.on ? `${device.speed}档` : "关闭";
  if (device.type === "curtain") return `${device.position}%`;
  if (device.type === "tv") return device.on ? "开启" : "关闭";
  if (device.type === "robot_vacuum") return `${device.status} · ${device.battery}%`;
  if (device.type === "pet_feeder") return `${device.portionsToday}份 · ${device.lastFeed}`;
  if (device.type === "presence_sensor" || device.type === "motion_sensor") {
    return device.detected ? "有人" : "无人";
  }
  if (device.type === "door_sensor") return device.open ? "开启" : "关闭";
  if (device.type === "camera") return device.privacyMode ? "隐私" : device.on ? "开启" : "关闭";
  if (device.type === "gas_heater") return device.on ? `${device.temperature}°C` : "关闭";
  if (device.type === "washer" || device.type === "dryer") {
    return device.status === "running" ? `${device.minutesLeft}分钟` : device.status;
  }
  if (device.type === "drying_rack") return `${device.position}%`;
  if (device.type === "generic_sensor" || device.type === "generic_entity") {
    return [device.value, device.unit].filter(Boolean).join(" ") || "只读";
  }
  return "待机";
}

function CommandConsole({ input, setInput, inputRef, messages, processing, onSubmit }) {
  return (
    <section className="panel console-panel">
      <div className="panel-title">
        <Bot size={17} />
        <h2>Command</h2>
        {processing && <span className="working">Parsing</span>}
      </div>
      <div className="message-list" aria-live="polite">
        {messages.slice(-8).map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            <div className="message-bubble">
              <p>{message.content}</p>
              <div className="message-meta">
                <span>{message.time}</span>
                {message.path && <span>{message.path}</span>}
                {typeof message.latency === "number" && (
                  <span className={`latency ${latencyClass(message.latency)}`}>{message.latency}ms</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <form
        className="command-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(input);
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="输入：关客厅灯 / 厨房有点闷 / 我要睡了"
          disabled={processing}
        />
        <button className="send-button" type="submit" disabled={processing || !input.trim()}>
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}

function PendingPlan({ plan, onConfirm, onCancel }) {
  if (!plan) return null;

  return (
    <section className="panel confirm-panel">
      <div className="panel-title">
        <LockKeyhole size={17} />
        <h2>Confirm</h2>
      </div>
      <p>{plan.summary}</p>
      <div className="confirm-actions">
        <button className="confirm-button" type="button" onClick={onConfirm}>
          <Check size={16} />
          确认
        </button>
        <button className="cancel-button" type="button" onClick={onCancel}>
          <X size={16} />
          取消
        </button>
      </div>
    </section>
  );
}

function PlanPreview({ plan }) {
  if (!plan) return null;

  return (
    <section className="panel plan-panel">
      <div className="panel-title">
        <ShieldCheck size={17} />
        <h2>Plan</h2>
        <span className={`path-badge ${plan.path === "fast" ? "fast" : "llm"}`}>
          {plan.path === "fast" ? "Fast Path" : plan.path === "llm-real" ? "LLM Real" : "LLM Sim"}
        </span>
      </div>
      <p className="plan-summary">{plan.summary}</p>
      <div className="step-list">
        {plan.steps.length === 0 ? (
          <div className="empty-step">No device action</div>
        ) : (
          plan.steps.map((step) => (
            <div className={`step risk-${step.risk}`} key={step.id}>
              <div>
                <strong>{step.deviceName}</strong>
                <span>{describeStep(step)}</span>
              </div>
              <small>{step.risk}</small>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function SensorSimulator({ devices, onToggle }) {
  const sensors = [devices.entry_motion, devices.kitchen_presence, devices.study_presence, devices.front_door];
  return (
    <section className="panel sensor-panel">
      <div className="panel-title">
        <Gauge size={17} />
        <h2>Sensors</h2>
      </div>
      <div className="sensor-grid">
        {sensors.map((sensor) => (
          <button className="sensor-button" key={sensor.id} type="button" onClick={() => onToggle(sensor.id)}>
            <span>{sensor.name.replace("传感器", "")}</span>
            <strong>{deviceStateLabel(sensor)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function AuditLog({ logs }) {
  return (
    <section className="panel audit-panel">
      <div className="panel-title">
        <Clock3 size={17} />
        <h2>Audit</h2>
      </div>
      <div className="audit-list">
        {logs.slice(0, 8).map((log) => (
          <div className={`audit-item ${log.level}`} key={log.id}>
            <span>{log.time}</span>
            <p>{log.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
