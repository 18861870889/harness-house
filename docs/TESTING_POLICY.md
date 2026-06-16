# Testing Policy

> Harness House 的测试必须保护真实家庭环境。自动化测试默认只读或模拟。

## 1. 测试分层

```text
Unit Tests
  HCM schema / planner / safety / service mapping

Contract Tests
  Adapter raw graph -> HCM

Simulation Tests
  Command -> HCM plan -> simulated service result

Read-only Provider Tests
  HA states / registry / supported_features snapshot

Manual Real-device Tests
  User-authorized only
```

场景级 benchmark 见 [TEST_CASES.md](TEST_CASES.md)。

## 2. 默认禁止

自动化测试、Codex 调试和 CI 默认禁止：

- 调用 HA `/api/services/*` 真实服务。
- 点击 UI 中会真实控制设备的按钮。
- 修改 HA 配置、自动化、helper、entity registry。
- 启动燃气、门锁、摄像头隐私相关动作。

## 3. 默认允许

无需额外授权可以：

- 读取 HA states。
- 读取 HA area / device / entity registry。
- 调用 Harness House dry-run endpoint。
- 使用 simulator adapter。
- 使用 HomeAssistantServiceSimulator。
- 回放 audit command，但必须强制 dry-run。

## 4. 真实设备测试门槛

只有用户明确授权后，才能执行真实设备动作。

真实控制前必须确认：

- 目标设备名称。
- 房间。
- entity id。
- action / service。
- 风险等级。
- 是否可能产生物理副作用。

## 5. 必测回归

每次改动以下模块都必须跑完整测试：

- `src/hcm*.js`
- `src/command*.js`
- `src/planValidator.js`
- `src/hcmExecutor.js`
- `src/hcmOverlay.js`
- `src/adapters/*.js`

命令：

```bash
npm test
npm run build
```

## 6. 失败复盘模板

当真实设备或模拟 service 映射失败时，记录：

```text
User command:
Expected behavior:
Actual behavior:
Command path:
HCM thing:
Capability:
Provider entity:
Provider attributes:
Selected service:
Why selected:
Root cause:
Regression test:
```

## 7. 当前经验

`小爱音箱停止播放音乐` 的失败证明：

- domain 不是能力边界。
- 同一 `media_player` 可能支持 pause，不支持 stop。
- executor 必须参考 provider 真实能力。
- 自动化调试应先模拟 service，不应直接试真实设备。
