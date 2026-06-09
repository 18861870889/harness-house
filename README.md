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
| AI Agent | Python + LLM API (OpenAI / local) |
| Orchestration | Rule engine + cron scheduler |
| Device Control | Home Assistant API / MQTT / REST |
| Communication | WebSocket / REST API / Telegram Bot |
| Data Store | SQLite / PostgreSQL |

## Quick Start

```bash
# Clone
git clone https://github.com/18861870889/harness-house.git
cd harness-house

# Install (coming soon)
pip install -r requirements.txt

# Configure (coming soon)
cp config.example.yaml config.yaml
# Edit config.yaml with your device info

# Run (coming soon)
python main.py
```

## Project Status

🚧 **Early Stage** — 仓库刚建立，架构设计中。

## License

MIT License