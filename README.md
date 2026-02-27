# NET.ai — Ollama-Powered Discord Bot

NET.ai is a self-hosted Discord assistant powered by locally running [Ollama](https://ollama.com) language models. It integrates a real-world tools API to give the AI access to live data — web search, weather, networking utilities, crypto prices, security advisories, and more — without relying on any cloud AI service.

---

## Features

- **Conversational AI** — Chat with any Ollama model directly inside Discord
- **Vision support** — Attach images and the bot will analyze them using a vision-capable model
- **Tool-augmented responses** — Automatically fetches live data when relevant:
  - Web search (DuckDuckGo)
  - Weather and forecasts
  - IP lookup, DNS resolution, ping, WHOIS, ASN, SSL certificate checks
  - Geocoding and reverse geocoding
  - Timezone lookups
  - Cryptocurrency prices
  - Hash / Base64 / subnet computation
  - Phone number validation
  - CVE / NVD security vulnerability lookups
  - HTTP status checks
- **Per-channel access control** — Restrict the bot to specific channels
- **User blacklist** — Block individual users from interacting with the bot
- **Conversation history** — Maintains short-term context per user
- **Rate limiting** — Configurable per-minute and per-hour request caps
- **Slash commands** — Manage configuration, view stats, set the active model, and more
- **Mermaid diagram rendering** — Renders Mermaid diagrams as images using Playwright
- **SQLite persistence** — Lightweight local database for conversation data
- **Structured logging** — Winston-based logging to console and file

---

## Prerequisites
_!IMPORTANT! You NEED the API to use online tools!_
| Requirement | Notes |
|---|---|
| [Node.js](https://nodejs.org) v18+ | Runtime |
| [Ollama](https://ollama.com) | Local AI inference server |
| [Ollama-Tools API](https://github.com/Gigg1E/Ollama-Tools) | Required — provides all real-world data endpoints |
| A Discord bot token | From the [Discord Developer Portal](https://discord.com/developers) |

### Ollama Models

Pull the required models before starting:

```bash
ollama pull qwen3:8b          # Primary chat model
ollama pull qwen3-vl:8b       # Vision model (image analysis)
ollama pull qwen2.5:1.5b      # Entity extractor (tool routing)
```

---

## Dependency: Ollama-Tools API

**This bot requires the [Ollama-Tools API](https://github.com/Gigg1E/Ollama-Tools) to be running before startup.**

The Tools API is a separate lightweight Node.js server that runs locally on port `3100` and provides all external data capabilities (search, weather, networking, etc.). Without it, the bot will start but all tool-based features will be unavailable.

**Setup:**

```bash
git clone https://github.com/Gigg1E/Ollama-Tools
cd Ollama-Tools/Ollama-Tools-API
npm install
npm start
```

Verify it is running:

```bash
curl http://localhost:3100/health
```

---

## Installation

```bash
git clone <your-repo-url>
cd NETai
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_id
```

---

## Configuration

All bot behaviour is controlled via [config.json](config.json). Key settings:

| Setting | Description |
|---|---|
| `bot.systemPrompt` | The AI's personality and instructions |
| `bot.historySize` | Number of prior messages retained per user |
| `bot.cooldownSeconds` | Per-user cooldown between messages |
| `ollama.chatModel` | Primary Ollama model for chat |
| `ollama.visionModel` | Model used for image analysis |
| `tools.enabled` | Enable or disable the Tools API integration |
| `channels.allowed` | List of channel IDs the bot will respond in |
| `rateLimit` | Per-minute and per-hour request limits |

---

## Running the Bot

**Development:**

```bash
npm run dev
```

**Production (compiled):**

```bash
npm run build
npm start
```

> Ensure Ollama is running (`ollama serve`) and the Ollama-Tools API is running on port `3100` before starting the bot.

---

## Slash Commands

| Command | Description |
|---|---|
| `/help` | Display available commands and usage |
| `/model` | View or change the active Ollama model |
| `/config` | View current bot configuration |
| `/stats` | Show usage statistics |
| `/status` | Check connectivity to Ollama and the Tools API |
| `/channel` | Manage allowed channels |
| `/blacklist` | Manage the user blacklist |
| `/webhook` | Configure webhook settings |

---

## Architecture

```
Discord
  └── discord.js client
        ├── Event handlers (message, interaction)
        ├── Ollama client (chat + vision inference)
        ├── Tool router (keyword + weight scoring)
        │     └── Ollama-Tools API (port 3100)
        ├── Entity extractor (qwen2.5:1.5b)
        ├── Mermaid renderer (Playwright)
        └── SQLite database (conversation history)
```

---

## License

MIT
