# Harness House Test Cases

> 目标：验证“所有真实 HCM 指令先经过大模型意图解析，再由本地 HCM / safety / executor 生成精确控制指令”。

## 1. 测试原则

- 自动化测试默认不控制真实 Home Assistant 设备。
- LLM 输出只作为 draft；必须经过 HCM normalize、safety gate 和 executor 编译。
- 任何不存在的设备、未声明能力、只读 sensor、高风险/隐私/配置能力都不能执行。
- 状态查询必须先由 LLM 选中 HCM thing，再由本地读取状态，不能让模型编造状态。
- 控制指令必须输出确定性 provider service，例如 `media_player.media_pause`。

## 2. 场景级覆盖

| 用户输入 | 期望意图 | 目标 | 期望结果 |
| --- | --- | --- | --- |
| 玄关人体目前是什么状态 | `state_query` | 入户传感器 | 本地读取 HCM 状态并回答 |
| 小爱音箱停止播放音乐 | `device_control` | 小爱音箱Pro | 编译为 `media_player.media_pause` |
| 我要晾衣服 | `scene` | 阳台晾衣杆 | 编译为 `cover.set_cover_position(position=100)` |
| 准备看电影 | `scene` | 客厅电视/窗帘/灯 | 编译为电视开、窗帘位置、灯光亮度 |
| 主卧空调调到 26 度 | `device_control` | 主卧空调 | 编译为 `climate.set_temperature(26)` |
| 打开猫猫监控 | `device_control` | 猫猫监控 | 隐私能力阻断 |
| 打开燃气热水器 | `device_control` | 燃气热水器 | 高风险能力阻断 |
| 打开地下室灯 | `device_control` | 不存在设备 | 拒绝，不编造设备 |
| 让玄关人体变成有人 | `device_control` | 入户传感器 | sensor 只读，拒绝执行 |

## 3. 模型输出噪声

必须覆盖：

- 模型同时输出 `query` 和有效 `actions` 时，以 actions 作为控制计划。
- 模型输出 sensor capability 到 `actions` 时，normalize 阶段拒绝。
- 模型输出不存在的 `device_id` 或 `capability` 时，normalize 阶段拒绝。
- 模型 summary 可以使用，但执行依据只能来自 HCM ids。

## 4. Personal Semantics 与解释

必须覆盖：

- `晾衣服` 只能在明确匹配晾衣杆等目标时生成 planner hint，不能只凭房间把阳台开关当成候选。
- `玄关人体` 可以作为状态查询 hint 指向入户传感器。
- Personal semantics 只作为 LLM planner hints 和解释证据，不直接生成 executable actions。
- Intent explainer 必须输出目标设备、能力、service、家庭语义和安全判断。
- 状态查询解释必须明确“只读状态查询，不执行设备动作”。

## 5. Capability Compression 与反馈闭环

必须覆盖：

- 每个 HCM thing 会压缩出设备级能力边界：可自动、需确认、只读、保护、配置。
- 全屋能力摘要不暴露原始 HA entity 噪声，只显示可执行/确认/只读/保护的总量和设备面。
- Review Queue 能压缩成设备级 review surfaces。
- `no_action` / `rejected` / `partial_failure` 进入 shadow correction candidates。
- correction candidates 不会自动变成 personal semantics 或 executable actions。

## 6. HA Service Simulator 与调试安全

必须覆盖：

- `media_player` 支持 pause 时，停止播放编译并模拟为 `media_player.media_pause`。
- `media_player` 不支持 pause 但支持 stop 时，停止播放编译为 `media_player.media_stop`。
- `media_player` 明确不支持某个 service 时，模拟层拒绝，真实 executor 不下发。
- 设备离线时，模拟层拒绝并返回 `thing_offline`。
- service call 的 entity 不在当前 HCM snapshot 时，模拟层拒绝并返回 `unknown_entity`。
- dry-run 解释必须显示“模拟校验”，并明确未触碰真实设备。
- 自动化测试不能调用真实 `/api/services/*`；真实设备验收必须人工触发。

## 7. Multi-Agent Runtime

必须覆盖：

- Context Agent 从人在传感器判断书房有人，置信度高于 motion sensor。
- 玄关人体传感器只能作为 motion 证据，不能等同于长期人在。
- Mapping Agent 只能生成 shadow-mode 接入/边界建议，不能直接修改 overlay。
- Mapping Agent 必须同时读取 unresolved bindings 和 HCM capability policy。
- Learning Agent 只能整理 shadow learning candidates，`autoApply` 必须为 false。
- Diagnostics Agent 必须能发现近期 rejected / partial_failure / error。
- Diagnostics Agent 必须能发现 HA service simulator 拦截。
- Test Agent 必须生成 dry-run control、safety rejection、state query 三类建议用例。
- 单个 agent 抛错必须被隔离，不能阻断其它 agent snapshot。
- agent 超出预算必须标记 `timedOut`，不能直接影响主链路执行。
- 命令 audit 只保存 agent 摘要，不保存过大的完整 snapshot。
- UI Agents 面板展示 shadow 状态，不能提供直接执行按钮。

## 8. Provider-to-HCM Onboarding

必须覆盖：

- 新增明确低风险设备，例如灯具，生成 `allow_auto_candidate`。
- 新增高风险设备，例如燃气热水器，生成 `protect`。
- 新增隐私设备，例如摄像头，生成 `protect`。
- 新增配置/密码类 `text/select/number` 能力，生成 `protect` 或 review。
- 设备改名和换房间必须形成 diff，但不能丢失 entity identity。
- `supported_features` 变化必须形成 state/provider diff 和 HCM binding change。
- entity 删除后必须生成 `remove_from_planner`。
- Onboarding simulation 只能使用本地 simulator，不控制真实 HA 设备。
- API 层只能生成 proposal，不能自动写入 overlay 开放真实设备。

## 9. Intent Accuracy Engine

必须覆盖：

- 状态查询不能被当成控制指令拦截。
- 合理跨房间场景，例如“我要晾衣服”，不能因为人在其它房间而误拦截。
- 用户显式提到房间时，计划目标如果全部落在其它房间，必须要求确认。
- 模糊当前位置表达，例如“这边有点热”，必须参考 Context Agent 的 likely space。
- 低置信度执行必须产生可观察 issue，不能静默通过。

## 10. Home Digital Twin State Layers

必须覆盖：

- selection 和 occupancy 是不同 layer，不能互相覆盖。
- preview 只用于 dry-run 目标。
- execution 只用于非 dry-run 执行目标。
- alert 只能标记 diagnostics 中真实存在的设备。
- UI 渲染层不能把“选中房间高亮”等同于“人在房间”。

## 11. Policy & Permission System

必须覆盖：

- 低风险、策略范围内动作通过 policy gate。
- 温控、亮度、风扇、窗帘等数值超出本地策略范围时，在 HA simulator 前拦截。
- 摄像头、燃气/热水器等保护设备即使被错误 overlay 开放，也被 policy gate 拦截。
- 洗衣机、烘干机、扫地机器人等长耗时设备启动必须要求确认或被拦截。
- 自动化测试不能为了验证 policy 而调用真实 HA service。

## 12. 自动化测试入口

核心场景 benchmark 位于：

- `src/harnessScenario.fixture.js`
- `src/hcmIntentBenchmark.test.js`
- `src/intentAccuracyEngine.test.js`
- `src/hcmCapabilityCompression.test.js`
- `src/personalSemantics.test.js`
- `src/intentExplainer.test.js`
- `src/learningLayer.test.js`
- `src/homeAssistantServiceSimulator.test.js`
- `src/agentRuntime.test.js`
- `src/providerOnboarding.test.js`
- `src/digitalTwinLayers.test.js`
- `src/policyEngine.test.js`

必须运行：

```bash
npm test
npm run build
```

## 13. 后续版本测试焦点

### v0.10 Real Home Pilot

- 真实设备测试必须人工授权。
- 只选低风险设备进入 pilot。
- 每次真实执行必须有 audit trace。
- HA 状态和 UI/3D 状态一致性需要抽样核对。
- 高风险、隐私、燃气、门锁、配置类能力保持 0 次自动执行。

### v0.15 Voice Interaction Alpha

- 语音识别结果必须进入同一条 `/api/hcm/command` 链路。
- `source=voice` 下不能执行配置类能力。
- 语音状态查询只读。
- 语音模糊指令必须经过 Intent Accuracy Engine。
- TTS 只能朗读结果，不能触发二次执行。

### v0.16 Event Runtime & Automation Proposals

- provider 事件只能生成 proposal，不能直接控制真实设备。
- 自动化 proposal 必须有触发条件、目标动作、风险说明和 dry-run 结果。
- 被用户拒绝或忽略的 proposal 不应反复打扰。

### v0.17 Adapter SDK

- 新 provider 必须通过 raw graph -> HCM contract tests。
- provider diff 必须能进入 onboarding plan。
- provider unavailable 时，上层 UI 和 planner 必须得到明确错误或 simulator fallback。
