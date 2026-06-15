# Harness-House 🏠🤖

> AI-powered smart home control system — 用AI接管你的家

## Vision

Harness-House 是一个开源智能家居AI控制系统，目标是：

- **统一控制**：将不同品牌/协议的智能家居设备整合到一个AI中枢
- **自然语言交互**：用对话式指令控制设备，无需手动操作App
- **场景自动化**：AI根据时间、天气、习惯自动调整家居状态
- **可扩展架构**：支持新设备/协议的插件式接入

## Architecture (Planned)

```
┌─────────────────────────────────────┐
│           AI Agent Layer            │
│   (LLM + Tools + Decision Engine)  │
├─────────────────────────────────────┤
│         Orchestration Layer         │
│   (Rule Engine / Scene Scheduler)  │
├─────────────────────────────────────┤
│          Device Adapter Layer       │
│   (HomeAssistant / MQTT / Zigbee   │
│    / WiFi / BLE / proprietary API) │
├─────────────────────────────────────┤
│            Physical Devices         │
│   (Lights / AC / Locks / Sensors)  │
└─────────────────────────────────────┘
```

## Tech Stack (Planned)

| Layer | Technology |
|-------|-----------|
| MVP UI | React + Vite |
| 3D House | Three.js |
| AI Runtime | Fast Path parser + simulated LLM path |
| Device Control | Local simulated device interfaces |
| Future Device Control | Home Assistant API / MQTT / REST |
| Future Data Store | SQLite / PostgreSQL |

## MVP

The current MVP runs locally and simulates smart-home devices in memory. It includes:

- Natural-language command console
- Fast Path command parser for common low-risk commands
- Hermes-style local LLM Gateway for fuzzy scene commands
- Simulated LLM fallback when no API key is configured
- Safety confirmation for high-risk actions
- Simulated device interfaces for lights, AC, fan, curtains, TV, gas water heater, sensors, pet feeder, drying rack, robot vacuum, washer, dryer, and camera
- Real-time 3D house visualization reflecting device and room state

## Quick Start

```bash
git clone https://github.com/18861870889/harness-house.git
cd harness-house

npm install
npm run dev

# Open the printed local URL, usually:
# http://localhost:5173
```

## Real LLM Gateway

By default, Harness House runs with the local `LLM Sim` fallback. To enable real model calls, create a local `.env` file:

```bash
cp .env.example .env
```

Then fill:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
```

Run:

```bash
npm run dev
```

The browser never receives the API key. Commands go through the local Hermes-style gateway:

```text
User message
-> /api/llm/plan
-> OpenAI-compatible model
-> strict JSON plan
-> Plan Validator
-> Safety Gate
-> Device Executor
```

If the real model times out or fails, the UI falls back to `LLM Sim` so the local demo remains usable.

## Home Assistant Adapter Alpha

Harness House can discover Home Assistant entities and map them into preliminary Harness device manifests. It can also execute low-risk actions for selected Home Assistant domains.

Add local environment variables:

```bash
HA_BASE_URL=http://homeassistant.local:8123
HA_TOKEN=your_long_lived_access_token
```

Then run:

```bash
npm run dev
```

Adapter endpoints:

```text
GET /api/adapters/home-assistant/status
GET /api/adapters/home-assistant/entities
POST /api/adapters/home-assistant/actions
```

Low-risk control currently supports:

- `light.turn_on/off` and brightness
- `fan.turn_on/off` and percentage
- `cover.set_cover_position` for low-risk curtains
- `media_player.turn_on/off`

Ambiguous `switch.*` entities are intentionally blocked from automatic real control until the mapping UI can confirm what the switch actually controls.

## Project Status

🚧 **MVP Stage** — local simulator and 3D house runtime are available. Real Home Assistant integration is planned next.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the planned version cadence from the local simulator MVP to real device adapters, capability boundaries, safety gates, learning layer, and multi-agent runtime.

## Engineering Workflow

Harness House follows a lightweight agentic engineering workflow inspired by Superpowers:

- HCM-first device modeling
- simulator-first debugging
- read-only provider verification
- safety-gated real execution
- contract tests for adapter behavior

See:

- [docs/ENGINEERING_PLAYBOOK.md](docs/ENGINEERING_PLAYBOOK.md)
- [docs/DEVICE_ADAPTER_CONTRACT.md](docs/DEVICE_ADAPTER_CONTRACT.md)
- [docs/TESTING_POLICY.md](docs/TESTING_POLICY.md)
- [docs/VERSION_WORKFLOW.md](docs/VERSION_WORKFLOW.md)

## License

MIT License
