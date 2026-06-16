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
import { createHouseSceneModel, getSceneRoomName } from "./houseSceneModel.js";
import {
  applyDefaultRunPolicy,
  deleteLearningCandidate,
  getCommandAudit,
  getHcmHome,
  getLearningMemory,
  replayCommandAudit,
  runHcmCommand,
  updateLearningCandidate,
  updateHcmThingOverride,
} from "./hcmClient.js";
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

function canUseRealHcmCommand(home, llmStatus) {
  return Boolean(
    home?.things?.length > 0 &&
      llmStatus?.configured &&
      llmStatus?.mode === "real",
  );
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
  const [defaultRunSummary, setDefaultRunSummary] = useState(null);
  const [commandAudit, setCommandAudit] = useState([]);
  const [learningMemory, setLearningMemory] = useState(null);
  const [intelligenceActionId, setIntelligenceActionId] = useState(null);
  const inputRef = useRef(null);

  const currentRoomId = useMemo(() => inferCurrentRoom(devices), [devices]);
  const houseSceneModel = useMemo(
    () =>
      createHouseSceneModel({
        hcmHome,
        simulatorRooms: rooms,
        simulatorDevices: devices,
      }),
    [devices, hcmHome],
  );
  const selectedRoomDevices = useMemo(
    () =>
      houseSceneModel.source === "hcm"
        ? houseSceneModel.devices.filter((device) => device.roomId === selectedRoomId)
        : Object.values(devices).filter((device) => device.roomId === selectedRoomId),
    [devices, houseSceneModel, selectedRoomId],
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

  const refreshIntelligence = useCallback(async () => {
    try {
      const [audit, memory] = await Promise.all([getCommandAudit({ limit: 8 }), getLearningMemory()]);
      setCommandAudit(audit.entries ?? []);
      setLearningMemory(memory);
    } catch {
      setCommandAudit([]);
      setLearningMemory(null);
    }
  }, []);

  useEffect(() => {
    refreshIntelligence();
  }, [refreshIntelligence]);

  const applyDefaultRun = useCallback(async () => {
    if (reviewActionId) return;
    setReviewActionId("default-run");
    setHcmStatus({ state: "loading", error: null });
    try {
      const result = await applyDefaultRunPolicy({ providerId: hcmHome?.provider?.id });
      setDefaultRunSummary(result.summary);
      setHcmHome(result.home);
      setHcmStatus({ state: "ready", error: null });
    } catch (error) {
      setHcmStatus({ state: "error", error: error.message });
    } finally {
      setReviewActionId(null);
    }
  }, [hcmHome?.provider?.id, reviewActionId]);

  const hideHcmThing = useCallback(
    async (thingId) => {
      if (!thingId || reviewActionId) return;
      setReviewActionId(`hide:${thingId}`);
      setHcmStatus({ state: "loading", error: null });
      try {
        await updateHcmThingOverride({
          providerId: hcmHome?.provider?.id,
          thingId,
          patch: { disabled: true },
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

  const replayAuditEntry = useCallback(
    async (entry) => {
      if (!entry?.commandId || intelligenceActionId) return;
      setIntelligenceActionId(`replay:${entry.commandId}`);
      try {
        const result = await replayCommandAudit({
          commandId: entry.commandId,
          currentRoomId,
          selectedRoomId,
        });
        setLogs((current) => [
          {
            id: crypto.randomUUID(),
            time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
            level: "info",
            text: `Dry-run 回放：${entry.input} -> ${result.status}，计划 ${result.plan?.actions?.length ?? 0} 个动作`,
          },
          ...current,
        ]);
        setMessages((current) => [
          ...current,
          makeMessage("assistant", `已完成 dry-run 回放：${result.plan?.summary ?? entry.input}`, {
            path: "hcm-replay",
            latency: result.latencyMs,
            planId: result.commandId,
          }),
        ]);
        await refreshIntelligence();
      } catch (error) {
        setLogs((current) => [
          {
            id: crypto.randomUUID(),
            time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
            level: "cancel",
            text: `Dry-run 回放失败：${error.message}`,
          },
          ...current,
        ]);
      } finally {
        setIntelligenceActionId(null);
      }
    },
    [currentRoomId, intelligenceActionId, refreshIntelligence, selectedRoomId],
  );

  const ignoreLearningCandidate = useCallback(
    async (candidate) => {
      if (!candidate?.id || intelligenceActionId) return;
      setIntelligenceActionId(`ignore:${candidate.id}`);
      try {
        const memory = await updateLearningCandidate({
          candidateId: candidate.id,
          status: "ignored",
          note: "用户在 Learning 面板忽略",
        });
        setLearningMemory(memory);
      } catch (error) {
        setLogs((current) => [
          {
            id: crypto.randomUUID(),
            time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
            level: "cancel",
            text: `学习候选更新失败：${error.message}`,
          },
          ...current,
        ]);
      } finally {
        setIntelligenceActionId(null);
      }
    },
    [intelligenceActionId],
  );

  const deleteLearningCandidateFromMemory = useCallback(
    async (candidate) => {
      if (!candidate?.id || intelligenceActionId) return;
      setIntelligenceActionId(`delete:${candidate.id}`);
      try {
        const memory = await deleteLearningCandidate({ candidateId: candidate.id });
        setLearningMemory(memory);
      } catch (error) {
        setLogs((current) => [
          {
            id: crypto.randomUUID(),
            time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
            level: "cancel",
            text: `学习候选删除失败：${error.message}`,
          },
          ...current,
        ]);
      } finally {
        setIntelligenceActionId(null);
      }
    },
    [intelligenceActionId],
  );

  async function submitCommand(raw = input) {
    const command = raw.trim();
    if (!command || processing) return;

    setInput("");
    setPendingPlan(null);
    setMessages((current) => [...current, makeMessage("user", command)]);
    setProcessing(true);

    if (canUseRealHcmCommand(hcmHome, llmStatus)) {
      try {
        const realResult = await runHcmCommand({
          input: command,
          currentRoomId,
          selectedRoomId,
        });
        if (
          realResult.plan?.actions?.length > 0 ||
          ["answered", "executed", "partial_failure", "rejected", "needs_confirmation", "dry_run", "no_action"].includes(
            realResult.status,
          )
        ) {
          handleRealCommandResult(realResult);
          setProcessing(false);
          return;
        }
      } catch (error) {
        setLogs((current) => [
          {
            id: crypto.randomUUID(),
            time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
            level: "info",
            text: `真实设备链路未执行，回退本地模拟：${error.message}`,
          },
          ...current,
        ]);
      }
    }

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

  async function handleRealCommandResult(result) {
    const okCount = result.execution?.results?.filter((item) => item.ok).length ?? 0;
    const failCount = result.execution?.results?.filter((item) => !item.ok).length ?? 0;
    const accepted = result.execution?.accepted ?? [];
    const logText =
      result.status === "answered"
        ? result.plan?.stateQuery?.summary || result.plan?.summary || "状态已读取。"
        : result.status === "no_action"
          ? result.plan?.summary || "没有找到可执行动作。"
          : result.status === "executed"
            ? `真实设备已执行：${accepted.map((item) => `${item.thingName} ${item.capabilityName}`).join("；")}`
            : result.status === "partial_failure"
              ? `真实设备部分执行：成功 ${okCount}，失败 ${failCount}`
              : result.status === "rejected"
                ? `真实设备计划被拒绝：${result.execution?.rejected?.map((item) => item.message).join("；")}`
                : result.plan?.summary ?? "真实设备计划已生成。";

    setLastPlan({
      id: result.commandId,
      kind: "real_hcm",
      path: "hcm-real",
      intent: result.plan?.intent ?? "real_hcm",
      confidence: result.plan?.confidence ?? 0.6,
      summary: result.plan?.summary ?? logText,
      resolution: result.resolution,
      explanation: result.explanation,
      steps: accepted.map((item) => ({
        id: `${item.thingId}:${item.capabilityId}`,
        deviceId: item.thingId,
        deviceName: item.thingName,
        capability: item.capabilityName,
        value: item.value,
        risk: "low",
        reason: item.service,
      })),
      commandResult: {
        commandId: result.commandId,
        status: result.status,
        path: "hcm-real",
        latencyMs: result.latencyMs,
        stages: [
          { name: "hcm_planner", latencyMs: result.latencyMs, mode: "real" },
          { name: "ha_executor", latencyMs: 0, status: result.status },
        ],
      },
    });
    setLogs((current) => [
      {
        id: crypto.randomUUID(),
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        level: result.status === "executed" || result.status === "answered" ? "success" : "info",
        text: logText,
      },
      ...current,
    ]);
    setMessages((current) => [
      ...current,
      makeMessage("assistant", logText, {
        path: "hcm-real",
        latency: result.latencyMs,
        planId: result.commandId,
      }),
    ]);
    refreshHcmHome();
    refreshIntelligence();
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
          sceneModel={houseSceneModel}
          selectedRoomId={selectedRoomId}
          onSelectRoom={handleSelectRoom}
        />
      </section>

      <aside className="left-rail">
        <Header
          currentRoomId={currentRoomId}
          activeCount={activeDevices.length}
          llmStatus={llmStatus}
          sceneRooms={houseSceneModel.rooms}
        />
        <SystemMetrics devices={devices} />
        <HcmCatalog
          home={hcmHome}
          status={hcmStatus}
          onRefresh={refreshHcmHome}
          onApplyDefaultRun={applyDefaultRun}
          onHideThing={hideHcmThing}
          reviewActionId={reviewActionId}
          defaultRunSummary={defaultRunSummary}
        />
        <RoomSelector rooms={houseSceneModel.rooms} selectedRoomId={selectedRoomId} onSelect={setSelectedRoomId} />
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
        <IntelligencePanel
          audit={commandAudit}
          memory={learningMemory}
          actionId={intelligenceActionId}
          onRefresh={refreshIntelligence}
          onReplay={replayAuditEntry}
          onIgnoreCandidate={ignoreLearningCandidate}
          onDeleteCandidate={deleteLearningCandidateFromMemory}
        />
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

function Header({ currentRoomId, activeCount, llmStatus, sceneRooms }) {
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
        <Fact icon={Layers3} label="当前区域" value={getSceneRoomName(currentRoomId, sceneRooms)} />
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

function HcmCatalog({
  home,
  status,
  onRefresh,
  onApplyDefaultRun,
  onHideThing,
  reviewActionId,
  defaultRunSummary,
}) {
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
  const defaultPolicy = defaultRunSummary ?? home?.defaultPolicy;

  return (
    <section className="panel hcm-panel">
      <div className="panel-title">
        <Network size={17} />
        <h2>Home Model</h2>
        <button className="mini-icon-button" type="button" onClick={onRefresh} title="同步真实设备">
          <RefreshCw size={14} />
        </button>
        <button
          className="mini-icon-button"
          type="button"
          onClick={onApplyDefaultRun}
          disabled={Boolean(reviewActionId)}
          title="默认开放可执行能力"
        >
          <Play size={14} />
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
            <Metric label="受保护能力" value={`${home.stats.unresolvedBindingCount}`} tone="danger" />
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
              {home.overlay.disabledThingCount > 0 && <span>隐藏 {home.overlay.disabledThingCount}</span>}
            </div>
          )}
          {defaultPolicy?.enabled && (
            <div className="default-run-summary">
              默认开放 <strong>{defaultPolicy.allowed}</strong>
              <span>保护 {defaultPolicy.protected}</span>
            </div>
          )}
          <CapabilityBoundarySummary summary={home.capabilitySummary} />
          <BindingReview
            review={home.review}
            reviewSurfaceCount={home.capabilitySummary?.reviewSurfaceCount}
            onHideThing={onHideThing}
            actionId={reviewActionId}
          />
          <div className="hcm-thing-list">
            {visibleThings.map((thing) => (
              <div className={`hcm-thing risk-${thing.policy.risk}`} key={thing.id}>
                <span>{thing.type}</span>
                <strong>{thing.name}</strong>
                <small>
                  {thing.boundary?.label ?? `${thing.state.autoExecutable}/${executableCapabilityCount(thing)} auto`}
                </small>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CapabilityBoundarySummary({ summary }) {
  if (!summary) return null;
  const totals = summary.totals ?? {};
  const deviceStates = summary.deviceStates ?? {};
  return (
    <div className="capability-boundary-summary">
      <div className="boundary-header">
        <span>能力边界</span>
        <strong>{summary.reviewSurfaceCount ?? 0}</strong>
      </div>
      <div className="boundary-grid">
        <span>
          可自动 <strong>{totals.executable ?? 0}</strong>
        </span>
        <span>
          需确认 <strong>{totals.confirmable ?? 0}</strong>
        </span>
        <span>
          只读 <strong>{totals.readOnly ?? 0}</strong>
        </span>
        <span>
          保护 <strong>{(totals.protected ?? 0) + (totals.config ?? 0)}</strong>
        </span>
      </div>
      <small>
        设备：自动 {deviceStates.executable ?? 0} · 确认 {deviceStates.confirmable ?? 0} · 保护{" "}
        {deviceStates.protected ?? 0} · 只读 {deviceStates.read_only ?? 0}
      </small>
    </div>
  );
}

function executableCapabilityCount(thing) {
  return (thing.capabilities ?? []).filter((capability) => capability.kind === "control" || capability.kind === "action")
    .length;
}

function BindingReview({ review, reviewSurfaceCount, onHideThing, actionId }) {
  if (!review || review.total === 0) return null;
  const recommendations = review.recommendations ?? { totalDevices: 0, bySeverity: {}, devices: [] };
  const severityItems = Object.entries(recommendations.bySeverity ?? {}).sort(
    ([first], [second]) => severityRank(second) - severityRank(first),
  );

  return (
    <div className="binding-review">
      <div className="review-header">
        <span>Review Queue</span>
        <strong>{reviewSurfaceCount ?? recommendations.totalDevices}</strong>
      </div>
      <div className="review-risk-strip">
        {severityItems.map(([severity, count]) => (
          <span className={`risk-chip severity-${severity}`} key={severity}>
            {severity} <strong>{count}</strong>
          </span>
        ))}
        <span className="risk-chip protected-total">
          protected <strong>{review.total}</strong>
        </span>
      </div>
      <div className="review-reasons">
        {(review.topReasons ?? []).slice(0, 3).map((item) => (
          <div className="review-reason" key={item.reason}>
            <span>{item.reason}</span>
            <strong>{item.count}</strong>
          </div>
        ))}
      </div>
      <AdjustmentRecommendations
        recommendations={recommendations}
        displayCount={reviewSurfaceCount}
        onHideThing={onHideThing}
        actionId={actionId}
      />
    </div>
  );
}

function severityRank(severity) {
  if (severity === "critical") return 3;
  if (severity === "high") return 2;
  if (severity === "medium") return 1;
  return 0;
}

function AdjustmentRecommendations({ recommendations, displayCount, onHideThing, actionId }) {
  const devices = recommendations?.devices ?? [];
  if (devices.length === 0) return null;

  return (
    <div className="adjustment-recommendations">
      <div className="recommendation-header">
        <span>建议调整</span>
        <strong>{displayCount ?? recommendations.totalDevices}</strong>
      </div>
      {devices.slice(0, 4).map((device) => (
        <div className={`recommendation-item severity-${device.severity}`} key={device.thingId || device.thingName}>
          <span>{device.thingName}</span>
          <strong>{device.count}</strong>
          <small>{device.action}</small>
          <button
            type="button"
            disabled={Boolean(actionId)}
            onClick={() => onHideThing(device.thingId)}
            title="从 AI 可控家庭模型中隐藏该设备"
          >
            <X size={11} />
            隐藏
          </button>
        </div>
      ))}
    </div>
  );
}

function RoomSelector({ rooms: sceneRooms, selectedRoomId, onSelect }) {
  return (
    <section className="panel room-panel">
      <div className="panel-title">
        <Home size={17} />
        <h2>Rooms</h2>
      </div>
      <div className="room-grid">
        {sceneRooms.map((room) => (
          <button
            className={room.id === selectedRoomId ? "room-button selected" : "room-button"}
            key={room.id}
            type="button"
            onClick={() => onSelect(room.id)}
          >
            <span>{room.name}</span>
            <small>{room.deviceCount ? `${room.deviceCount} 设备` : room.presence ? "有人" : "待机"}</small>
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
  if (device.statusLabel) return device.statusLabel;
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
  const explanationLines = plan.explanation?.summary?.split("\n").filter(Boolean) ?? [];

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
      {explanationLines.length > 0 && (
        <div className="intent-explanation">
          <div className="explanation-title">{plan.explanation.title ?? "Intent Explanation"}</div>
          {explanationLines.slice(0, 6).map((line) => (
            <div className="explanation-line" key={line}>
              {line}
            </div>
          ))}
        </div>
      )}
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

function IntelligencePanel({ audit, memory, actionId, onRefresh, onReplay, onIgnoreCandidate, onDeleteCandidate }) {
  const candidates = memory?.topCandidates ?? [];
  const corrections = memory?.correctionCandidates ?? [];
  return (
    <section className="panel intelligence-panel">
      <div className="panel-title">
        <Bot size={17} />
        <h2>Learning</h2>
        <button className="mini-icon-button" type="button" onClick={onRefresh} title="刷新审计和学习摘要">
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="learning-metrics">
        <Metric label="审计" value={`${audit.length}`} />
        <Metric label="候选" value={`${memory?.candidateCount ?? 0}`} />
        <Metric label="忽略" value={`${memory?.ignoredCount ?? 0}`} />
      </div>
      <div className="learning-list">
        {candidates.length === 0 ? (
          <div className="learning-empty">Shadow mode</div>
        ) : (
          candidates.slice(0, 3).map((candidate) => (
            <div className="learning-candidate" key={candidate.id}>
              <div>
                <span>{candidate.type}</span>
                <strong>{candidate.input}</strong>
                <small>
                  {candidate.count}x · {Math.round(candidate.confidence * 100)}%
                </small>
              </div>
              <div className="candidate-actions">
                <button
                  type="button"
                  disabled={Boolean(actionId)}
                  onClick={() => onIgnoreCandidate(candidate)}
                  title="忽略这个学习候选"
                >
                  忽略
                </button>
                <button
                  type="button"
                  disabled={Boolean(actionId)}
                  onClick={() => onDeleteCandidate(candidate)}
                  title="删除并阻止它从历史观察中立刻重建"
                >
                  <X size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
      {corrections.length > 0 && (
        <div className="correction-list">
          <div className="correction-header">
            <span>需要纠错</span>
            <strong>{corrections.length}</strong>
          </div>
          {corrections.slice(0, 3).map((candidate) => (
            <div className="correction-candidate" key={candidate.id}>
              <span>{candidate.input}</span>
              <small>{candidate.reason}</small>
            </div>
          ))}
        </div>
      )}
      <div className="audit-mini-list">
        {audit.slice(0, 3).map((entry) => (
          <div className={`audit-mini-item ${entry.status}`} key={entry.commandId}>
            <div>
              <span>{entry.status}</span>
              <strong>{entry.input}</strong>
              <small>{entry.latencyMs}ms</small>
            </div>
            <button
              type="button"
              disabled={Boolean(actionId)}
              onClick={() => onReplay(entry)}
              title="以 dry-run 模式回放该命令"
            >
              <Play size={11} />
              回放
            </button>
          </div>
        ))}
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
