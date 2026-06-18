# Harness House

> Local-first AI smart-home runtime. 用自然语言 harness 你的家，而不是再多装一个遥控器 App。

Harness House 是一个开源智能家居 AI 框架，目标不是替代 Home Assistant，而是在 Home Assistant、米家、Matter、Tuya 等设备承载层之上，提供统一的家庭能力模型、AI 意图理解、安全执行、调试模拟和持续学习能力。

当前进度：`v0.17`

当前状态和近期计划见 [docs/CURRENT_STATUS.md](docs/CURRENT_STATUS.md)。

## Core Idea

Harness House 的核心范式是：

```text
Provider Raw Graph
  -> Provider Adapter
  -> Harness Capability Model
  -> LLM Planner
  -> Intent Accuracy Engine
  -> Safety Gate
  -> Policy Gate
  -> Provider Adapter Compile / Simulate
  -> Authorized Provider Execute
  -> Audit / Learning / Agents
```

几个关键原则：

- AI 负责理解意图和生成候选计划。
- Runtime 负责能力边界、安全策略、service 编译和执行。
- Home Assistant 只是 provider，不是上层业务模型。
- 自动化调试默认不控制真实设备。
- 后台 agent 只生成建议，不直接修改生产规则。
- 主链路目标是 2 秒左右返回结果，长耗时设备不要求 2 秒内物理完成。

## Current Capabilities

### Local 3D MVP

- React + Vite + Three.js 本地界面。
- 3D 房屋展示房间和设备状态。
- 支持拖拽旋转、房间选择、设备点展示。
- Morning Mint 浅色运行界面，使用独立颜色表达选择、占用、执行、预览和告警。
- 桌面和移动端响应式布局，输入时不会卸载或重建 3D Canvas。
- 本地 simulator 支持灯、空调、风扇、窗帘、电视、燃气热水器、传感器、猫粮机、晾衣杆、扫地机器人、洗衣机、烘干机、监控等设备模拟。

### Real LLM Planning

- OpenAI-compatible LLM Gateway。
- 当前可配置 DeepSeek / OpenAI-compatible API。
- 所有真实 HCM 指令先经过 LLM 意图解析，再由本地 HCM normalize / safety / executor 校验。
- 状态查询也经过 LLM 选目标，但状态内容由本地 HCM 读取，避免模型编造。

### Home Assistant Integration

- HA registry / states discovery。
- HA device/entity/area -> Harness Capability Model。
- HCM 统一表达：
  - `Space`
  - `Thing`
  - `Capability`
  - `State`
  - `Action`
  - `Policy`
- HCM Overlay 保存本地审核结果。
- 默认保护摄像头、燃气、配置项、文本项、敏感传感器。

### Safety & Debugging

- Safety Gate 拦截未知设备、未知能力、只读 sensor、高风险能力。
- HA Service Simulator 在真实执行前模拟 service call。
- 支持根据 `media_player.supported_features` 选择 `media_pause` / `media_stop` / `turn_off`。
- dry-run 解释会显示“模拟校验”，明确是否触碰真实设备。
- 自动化测试不调用真实 `/api/services/*`。

### Learning & Agents

- Command audit：记录每条真实 HCM 命令的阶段、耗时、计划、执行和解释摘要。
- Replay：历史命令可用 dry-run 回放。
- Learning Layer：从 `no_action` / `rejected` / `partial_failure` 生成 shadow correction candidates。
- Multi-Agent Runtime `v0.9`：
  - `Context Agent`：从 presence / motion / door sensor 推断房间占用置信度。
  - `Learning Agent`：整理 shadow learning candidates，不自动应用。
  - `Mapping Agent`：生成设备接入与能力边界建议。
  - `Diagnostics Agent`：发现离线设备、失败指令、service simulator 拦截和 2 秒预算问题。
  - `Test Agent`：基于 HCM 生成 dry-run / safety / state query 回归测试建议。
- 每个后台 agent 独立记录耗时和预算状态；单个 agent 失败不会阻断主链路。
- Agents 目前全部是 shadow mode，不写 overlay、不执行设备。

### Provider-to-HCM Onboarding

- `ProviderSnapshotDiff` 检测 HA device/entity/area/state 的新增、删除和变更。
- `OnboardingPlanner` 把 provider diff 转成 HCM 接入候选。
- 新设备会被分类为 `allow_auto_candidate` / `review` / `protect` / `read_only`。
- 新增高风险、隐私、配置、语义不清设备默认保护。
- Onboarding 只生成 overlay proposal，不自动开放真实设备。
- 支持记录当前 HA graph 为 baseline，后续新增/变更设备进入 Onboarding Plan。

### Adapter SDK & Provider Portability

- Provider Adapter Contract `1.0` 统一身份、连接状态、发现、HCM 映射、动作编译、模拟、执行和状态读取。
- Provider-neutral Snapshot `1.0` 统一 spaces/devices/entities/states，并支持稳定 ID diff。
- Capability Evidence 记录能力来源、可用命令、约束、状态证据和映射置信度。
- Simulator 与 Home Assistant 已迁移到同一契约，并通过同一 Contract Harness。
- Adapter Registry 统一管理 Provider；`GET /api/adapters` 可查看已注册 Adapter 和连接状态。
- 真实执行必须携带成功模拟结果、runtime 授权和 command ID；直连 HA action API 已关闭。

### Intent Accuracy & Policy Gates

- `Intent Accuracy Engine` 在 LLM 输出后检查显式房间、人在位置、模糊表达、低置信度执行。
- 明确房间错配和上下文错配会转为确认，不直接执行。
- `Policy Gate` 位于 Safety Gate 之后、HA simulator 之前，处理本地权限和运行边界。
- 当前已覆盖温控/亮度/窗帘/风扇数值范围、保护设备类型、长耗时设备启动确认。

### Home Digital Twin Layers

- 3D scene model 支持 `selection / occupancy / execution / alert / preview` 五类状态层。
- 选中房间高亮和人在区域高亮已经拆分，后续语音定位和执行动画可以复用同一套 layer。
- dry-run 目标显示为 preview，真实执行目标显示为 execution，诊断问题显示为 alert。

### Independent Speech I/O

- 浏览器 Web Speech API 是首个可替换 STT/TTS provider。
- 按键录音，高置信度最终转写进入与键盘相同的命令链路。
- 低置信度转写只填入输入框，不自动执行。
- 默认半双工：TTS 播放时停止 STT，避免系统听到自己的播报。
- 不接小爱，不做常开监听和唤醒词。

### Home Event & Automation Suggestions

- 只读采集 HCM 状态快照并记录状态变化事件。
- 至少两次相似成功执行才会生成 shadow 自动化建议。
- 建议可以模拟、标记已审核或忽略，但不能启用或写入 HA 自动化。
- 自动化模拟复用 HCM Executor、Policy Gate 和 HA Service Simulator，不控制真实设备。

## Quick Start

```bash
git clone https://github.com/18861870889/harness-house.git
cd harness-house

npm install
npm run dev
```

打开：

```text
http://localhost:5173
```

运行测试和构建：

```bash
npm test
npm run build
```

## Local Environment

创建本地 `.env` 文件：

```bash
touch .env
```

### LLM

```bash
OPENAI_API_KEY=your_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

也可以使用 OpenAI-compatible provider，例如 DeepSeek：

```bash
OPENAI_API_KEY=your_key_here
OPENAI_BASE_URL=https://api.deepseek.com/v1
OPENAI_MODEL=deepseek-v4-flash
```

### Home Assistant

```bash
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=your_home_assistant_long_lived_access_token
```

本地运行态文件默认写入：

```text
data/home-model-overlay.local.json
data/command-audit.local.jsonl
data/learning-memory.local.json
data/provider-snapshot.local.json
data/automation-memory.local.json
```

这些文件是本地家庭状态和用户偏好数据，不应提交到 GitHub。

## API Surface

常用本地接口：

```text
GET  /api/llm/status
POST /api/llm/plan

GET  /api/adapters/home-assistant/status
GET  /api/adapters/home-assistant/entities
GET  /api/adapters

GET  /api/hcm/home
POST /api/hcm/command
GET  /api/hcm/overrides
POST /api/hcm/overrides/bindings
POST /api/hcm/overrides/things
POST /api/hcm/overrides/default-run

GET  /api/commands/audit
POST /api/commands/replay

GET  /api/learning/memory
PATCH /api/learning/candidates/:candidateId
DELETE /api/learning/candidates/:candidateId

GET  /api/agents/snapshot

GET  /api/onboarding/plan
POST /api/onboarding/snapshot

GET   /api/automation/suggestions
POST  /api/automation/events/capture
PATCH /api/automation/suggestions/:suggestionId
POST  /api/automation/suggestions/:suggestionId/simulate
```

`/api/hcm/command` 是当前真实 HCM 主链路入口：

```text
Context Snapshot
  -> Policy Overlay
  -> Context Agent Snapshot
  -> Personal Semantics
  -> Prompt Compile
  -> LLM Planner
  -> Plan Normalize
  -> Intent Accuracy Engine
  -> Safety Gate
  -> Policy Gate
  -> Provider Adapter Compile / Simulate
  -> Authorized Provider Execute
  -> Audit / Learning / Agents
```

## Version Progress

已完成：

- `v0.1` Local Simulator MVP
- `v0.2` Device Manifest & Capability Runtime
- `v0.3` Home Assistant Adapter Alpha
- `v0.3.2` Harness Capability Model & Provider Sync
- `v0.3.3` HCM Overlay & Review Decisions
- `v0.4` Mapping UI & Device Boundary Review
- `v0.5` Production-grade Command Pipeline
- `v0.6` Learning Layer Alpha
- `v0.7` Intent Precision & Explainability
- `v0.8` HA Service Simulation & Debug Safety
- `v0.9` Shadow Multi-Agent Runtime
- `v0.11` Provider-to-HCM Onboarding & Adapter Abstraction
- `v0.12` Intent Accuracy Engine
- `v0.13` Home Digital Twin State Layers
- `v0.14` Policy & Permission System
- `v0.15` Independent STT & TTS Alpha
- `v0.16` Home Event & Automation Suggestions
- `v0.16.1` Morning Mint UI Refresh
- `v0.17` Adapter SDK & Provider Portability

后续重点：

- `v0.10` Real Home Pilot：完成真实住宅七天稳定性和低风险设备验收。
- `v1.0` Local-first Open Smart Home AI Framework。

完整规划见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## Safety Policy

开发和测试默认遵循：

- 自动化测试不控制真实 HA 设备。
- 真实执行必须经过 HCM、Intent Accuracy Engine、Safety Gate、Policy Gate 和 Provider Adapter Simulator。
- 高风险、敏感、配置、隐私能力默认保护。
- 学习结果和 agent 建议默认 shadow mode。
- 任何 provider 的原始实体都不能绕过 HCM 直接交给 LLM 执行。

更多细节：

- [docs/HA_DEBUGGING_POLICY.md](docs/HA_DEBUGGING_POLICY.md)
- [docs/TESTING_POLICY.md](docs/TESTING_POLICY.md)
- [docs/TEST_CASES.md](docs/TEST_CASES.md)

## Engineering Docs

- [docs/PRD-v1.md](docs/PRD-v1.md)
- [docs/CURRENT_STATUS.md](docs/CURRENT_STATUS.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/ENGINEERING_PLAYBOOK.md](docs/ENGINEERING_PLAYBOOK.md)
- [docs/DEVICE_ADAPTER_CONTRACT.md](docs/DEVICE_ADAPTER_CONTRACT.md)
- [docs/ADAPTER_SDK.md](docs/ADAPTER_SDK.md)
- [docs/VERSION_WORKFLOW.md](docs/VERSION_WORKFLOW.md)

## License

MIT License
