# Harness House Roadmap

> 目标：把当前本地 3D 智能家居 MVP 演进成可接入真实设备、可理解设备能力边界、可安全执行、可持续自学习的开源 AI smart-home runtime。

## 1. 产品演进原则

Harness House 不应该直接变成“又一个 Home Assistant 面板”。它的核心价值是：

- 用自然语言表达意图。
- 把不同生态的设备归一成统一能力模型。
- 让 AI 只负责理解和规划，让 runtime 负责校验、安全和执行。
- 保持 2 秒内反馈的主链路。
- 把学习、总结、规则生成放到后台异步完成。

主链路约束：

```text
User Command
  -> Context Snapshot
  -> Command Router
  -> LLM Planner or Fast Path
  -> Plan Validator
  -> Safety Gate
  -> Device Runtime
  -> Adapter
  -> Result
```

2 秒内返回的结果可以是：

- 已执行。
- 已下发。
- 需要确认。
- 失败原因。

不要求窗帘、晾衣杆、扫地机器人、洗衣机等长耗时设备在 2 秒内物理完成。

## 2. 版本节奏

### v0.1 - Local Simulator MVP

状态：已完成初版。

目标：

- 本地运行。
- 模拟智能家居设备接口。
- 3D 房屋实时反映设备状态。
- 支持真实 LLM JSON planning。
- 支持高风险确认。

已具备：

- React + Vite + Three.js 本地界面。
- 本地设备状态模拟。
- Fast Path 解析。
- LLM Gateway，兼容 OpenAI-style API。
- DeepSeek real mode。
- 3D 状态展示、拖拽旋转、基础设备动画。

验收：

- `npm run build` 通过。
- 本地页面可打开。
- 常见命令能在 2 秒左右返回。
- 高风险设备不会绕过确认。

### v0.2 - Device Manifest & Capability Runtime

目标：

把当前 `simulator.js` 里的设备数据升级为正式的 Harness Device Manifest。

新增能力：

- `DeviceManifest`：描述设备身份、房间、来源、状态、能力、风险。
- `CapabilityRegistry`：统一管理每个设备能做什么。
- `PlanValidator`：只允许 LLM 输出 manifest 中声明过的动作。
- `SimulatorAdapter`：当前本地模拟器成为第一个 adapter，而不是散落在业务逻辑里。

核心数据结构：

```json
{
  "id": "living_curtain",
  "name": "客厅窗帘",
  "roomId": "living",
  "type": "curtain",
  "source": "simulator",
  "capabilities": [
    {
      "name": "set_position",
      "valueType": "number",
      "min": 0,
      "max": 100,
      "unit": "%",
      "risk": "low",
      "confirmation": "never"
    }
  ],
  "state": {
    "position": 78,
    "online": true
  }
}
```

验收：

- LLM prompt 不再直接依赖散乱设备字段，而是依赖 capabilities。
- 未声明能力的动作会被拒绝。
- 越界值会被拦截，例如窗帘 `set_position=180`。
- 现有 demo 行为不回退。

测试要求：

- Manifest schema 单元测试。
- Capability range validation 测试。
- 高风险 confirmation 测试。
- 现有命令回归测试。

### v0.3 - Home Assistant Adapter Alpha

目标：

先接 Home Assistant，因为它覆盖设备生态最快，但 Harness House 不绑定死在 HA 上。

新增能力：

- HA REST / WebSocket 连接配置。
- HA entity discovery。
- HA entity -> Harness Device 映射。
- 基础 service 调用：
  - `light.turn_on/off`
  - `switch.turn_on/off`
  - `climate.set_temperature`
  - `cover.set_cover_position`
  - `fan.turn_on/off`
  - `media_player.turn_on/off`

关键设计：

```text
Home Assistant Entity
  -> Adapter Discovery
  -> Mapping Review
  -> Harness Device Manifest
  -> Capability Registry
  -> AI Planner
```

验收：

- 能连接一个本地 HA 实例。
- 能发现实体列表。
- 用户能把 HA entity 映射为房间和设备类型。
- 至少支持灯、窗帘、空调、风扇、开关五类真实设备。
- HA 不可用时，系统能回退到 simulator 或返回明确错误。

测试要求：

- HA API mock 测试。
- Adapter contract test。
- 网络失败、token 错误、entity missing 测试。
- 真实 HA 手工验收清单。

### v0.4 - Mapping UI & Device Boundary Review

目标：

让用户清楚知道每个设备的能力边界，避免 AI “想当然”控制设备。

新增能力：

- 设备发现页面。
- 房间归属配置。
- 设备类型确认。
- 能力边界查看。
- 风险等级编辑。
- “允许 AI 自动执行 / 需要确认 / 永不自动执行”策略。

示例：

```text
switch.xiaomi_123
  用户确认：燃气热水器
  风险等级：high
  自动执行：禁止
  允许能力：turn_off
  turn_on：必须确认
```

验收：

- 未完成映射的实体不会进入 AI 可控设备列表。
- 用户可以把普通 switch 标记为高风险设备。
- LLM prompt 只包含已启用设备和已启用能力。
- UI 能清楚展示设备当前状态和可用动作。

测试要求：

- 映射保存/读取测试。
- 风险策略测试。
- prompt 生成快照测试。
- 配置迁移测试。

### v0.5 - Production-grade Command Pipeline

目标：

把现在的命令执行链路拆成可测试、可观测的后端 pipeline。

新增模块：

- `CommandRouter`
- `ContextSnapshot`
- `LLMPlanner`
- `FastPathPlanner`
- `PlanValidator`
- `SafetyGate`
- `DeviceExecutor`
- `AuditLog`

链路输出必须结构化：

```json
{
  "commandId": "cmd_...",
  "path": "llm-real",
  "latencyMs": 1280,
  "status": "executed",
  "plan": [],
  "results": [],
  "safety": {
    "level": "low",
    "confirmationRequired": false
  }
}
```

验收：

- 每条指令都有 command id。
- 每一步有耗时记录。
- 每次 LLM 调用可以在本地 audit 中看到请求摘要和响应摘要。
- 失败可解释。
- 2 秒 SLA 可以被自动测试。

测试要求：

- Pipeline integration tests。
- Latency budget tests。
- LLM timeout fallback tests。
- Audit log snapshot tests。

### v0.6 - Learning Layer Alpha

目标：

开始做 “越用越懂主人”，但不让学习逻辑直接改主链路。

新增能力：

- 用户纠错记录。
- 命令 -> 实际执行计划记忆。
- 场景偏好记忆。
- 异步 Evolution Worker。
- 规则候选生成，但默认需要用户确认后启用。

学习对象：

- 别名：`晾衣服 -> 阳台晾衣杆 set_position 100`
- 偏好：`睡觉 -> 主卧空调 25 度`
- 禁忌：`夜间不要打开客厅监控`
- 场景：`看电影 -> 客厅电视 + 灯光 + 窗帘`

验收：

- 学习结果不会自动越权执行。
- 用户可以查看、禁用、删除学习规则。
- 新规则上线前有 shadow mode。
- 学习不会影响高风险设备确认策略。

测试要求：

- Memory write/read tests。
- Shadow mode simulation。
- Preference conflict tests。
- Safety regression tests。

### v0.7 - Multi-Agent Runtime

目标：

引入多 agent，但只用于提升可靠性和可维护性，不在主链路里做长时间争论。

建议 agent 分工：

| Agent | 职责 | 是否在主链路 |
| --- | --- | --- |
| Intent Agent | 解析自然语言，生成候选计划 | 是，最多一次 LLM |
| Safety Agent | 审查风险、权限、确认策略 | 是，本地优先 |
| Device Agent | 根据 manifest 执行设备动作 | 是 |
| Context Agent | 维护房间、人在、时间、设备快照 | 否，异步更新快照 |
| Learning Agent | 从日志中总结偏好和规则 | 否，异步 |
| Diagnostics Agent | 检查失败、离线、延迟异常 | 否，异步 |
| Test Agent | 自动生成回归用例和仿真场景 | 否，开发期 |

主链路不做 agent debate。可接受的模式是：

```text
Intent Agent 生成 plan
Safety Agent 本地校验
Device Agent 执行
Learning/Diagnostics 后台观察
```

验收：

- 多 agent 失败不会阻塞基础控制。
- Learning Agent 只生成建议，不直接改生产规则。
- Diagnostics Agent 能发现 adapter 失败、设备离线、响应慢。
- Test Agent 能基于设备 manifest 生成命令测试集。

测试要求：

- Agent contract tests。
- Agent timeout tests。
- Background worker retry tests。
- Generated test case review。

### v0.8 - Real Home Pilot

目标：

在真实住宅里小范围试运行。

范围建议：

- 先接低风险设备：
  - 灯
  - 风扇
  - 窗帘
  - 电视
  - 空调温度
- 暂缓自动控制：
  - 燃气热水器
  - 摄像头隐私
  - 门锁类设备
  - 洗衣机/烘干机启动

验收：

- 连续运行 7 天。
- 常见命令 P95 小于 2 秒返回。
- 真实设备状态与 UI 状态一致率高于 98%。
- 高风险动作 0 次误执行。
- 所有失败都有 audit log。

测试要求：

- 每日 smoke test。
- HA reconnect test。
- 断网/断电恢复测试。
- 实体重命名/删除测试。

### v1.0 - Open Source AI Smart Home Framework

目标：

作为开源项目对外发布第一版稳定框架。

必须具备：

- Device Manifest 标准。
- Simulator Adapter。
- Home Assistant Adapter。
- Capability Registry。
- Safety Gate。
- LLM Planner。
- Fast Path。
- Audit Log。
- Mapping UI。
- 基础 Learning Layer。
- 完整开发文档。

v1.0 不追求：

- 支持所有品牌原生云。
- 完全自动自进化。
- 复杂多用户权限。
- 全屋无人值守自动控制。

## 3. 测试策略

### 3.1 测试金字塔

```text
Unit Tests
  Manifest schema
  Capability validation
  Risk policy
  Plan validation
  Device state reducer

Integration Tests
  Command pipeline
  LLM timeout fallback
  HA adapter mock
  Simulator adapter

E2E Tests
  Browser command input
  3D state reflection
  Confirmation flow
  Mapping UI

Pilot Tests
  Real HA instance
  Real low-risk devices
  Failure recovery
```

### 3.2 必测场景

低风险：

- `关客厅灯`
- `打开书房风扇`
- `客厅窗帘关上`
- `厨房有点闷`

中风险：

- `我要洗衣服`
- `启动扫地机器人`
- `我要晾衣服`

高风险：

- `打开燃气热水器`
- `关闭监控隐私模式`

模糊指令：

- `有点热`
- `太亮了`
- `我要睡了`
- `准备看电影`

异常：

- 设备离线。
- entity 不存在。
- LLM 超时。
- adapter 返回失败。
- 状态回读不一致。

### 3.3 自动化测试门禁

每个 PR 至少通过：

```bash
npm run build
npm run test
```

如果接入真实设备 adapter，需要额外通过：

```bash
npm run test:adapter
npm run test:e2e
```

当前仓库还没有完整测试框架，建议 v0.2 同步引入 Vitest，v0.3 引入 HA mock server，v0.4 引入 Playwright。

## 4. 多 Agent 开发协作

多 agent 不只是产品能力，也可以用于开发流程。

建议开发期 agent 分工：

| Agent | 产物 |
| --- | --- |
| Architecture Agent | manifest、pipeline、adapter contract 设计 |
| Runtime Agent | DeviceRuntime、CapabilityRegistry、Executor |
| Adapter Agent | HA/MQTT/Matter adapter |
| Frontend Agent | Mapping UI、3D 状态、操作台 |
| Test Agent | 单测、集成测试、E2E 测试 |
| Safety Agent | 风险等级、确认策略、权限边界 |
| Docs Agent | README、PRD、adapter 开发文档 |

每个 agent 的输出都要经过同一套门禁：

- 是否符合 manifest contract。
- 是否有测试。
- 是否不泄露 key。
- 是否不绕过 Safety Gate。
- 是否保持 2 秒主链路目标。

## 5. 近期实施建议

当前正在推进 v0.2 系列，因为它决定后续所有真实设备接入的地基。

已完成：

1. `v0.2.0`：新增 `DeviceManifest`、`CapabilityRegistry`、capability boundary validation。
2. `v0.2.0`：改造 LLM prompt，只暴露已启用 capabilities。
3. `v0.2.0`：补 Vitest 测试，覆盖 manifest、validator、安全确认。
4. `v0.2.1`：抽出 `SimulatorAdapter`，让内存模拟执行逻辑从命令解析里解耦。

下一步建议：

1. `v0.2.2`：把 `PlanValidator` 从 `createPlan` 中拆成独立模块，输出结构化 validation report。
2. `v0.2.3`：新增 command pipeline result，记录 router、planner、validator、safety、executor 的 latency。
3. `v0.3.0`：开始 Home Assistant Adapter，只做 discovery 和 read state。
4. `v0.3.1`：接入低风险真实控制：灯、风扇、窗帘、电视。

完成 v0.2 后，再接 Home Assistant 会更稳。否则现在直接接 HA，后面会把品牌差异、设备能力、风险策略全堆进业务代码，后期维护成本会明显上升。
