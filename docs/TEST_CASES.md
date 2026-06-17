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

## 9. 自动化测试入口

核心场景 benchmark 位于：

- `src/harnessScenario.fixture.js`
- `src/hcmIntentBenchmark.test.js`
- `src/hcmCapabilityCompression.test.js`
- `src/personalSemantics.test.js`
- `src/intentExplainer.test.js`
- `src/learningLayer.test.js`
- `src/homeAssistantServiceSimulator.test.js`
- `src/agentRuntime.test.js`
- `src/providerOnboarding.test.js`

必须运行：

```bash
npm test
npm run build
```
