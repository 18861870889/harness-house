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

## Project Status

🚧 **MVP Stage** — local simulator and 3D house runtime are available. Real Home Assistant integration is planned next.

## License

MIT License
