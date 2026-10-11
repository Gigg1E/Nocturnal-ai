# Nocturnal

A Discord bot powered by [Ollama](https://ollama.com) that talks like a person, not a help desk. It has opinions and a sense of humor, it can look things up while you chat, and it remembers the people it talks to.

Nocturnal has two ways of joining a conversation:

- **Chat mode**: mention it or reply to it, and it answers like a friend would.
- **Answer Machine**: switch a channel into this mode, and it listens along. It only speaks up to answer a question nobody has answered, to correct something that's wrong, or to chime in when it fits. Otherwise it stays quiet and maybe drops an emoji reaction.

---

## Features

### Chat mode
- **Mention or reply to talk.** Works in any channel the server allows.
- **A personality, not an assistant voice.** Warm, dry and a little teasing by default. No roleplay asterisks and no forced follow-up questions.
- **Per-user personality.** Anyone can rewrite how Nocturnal talks to them with `/personality`, and it applies everywhere.
- **Long-term memory.** It picks up facts people share and brings them up when relevant. `/memory` shows what it remembers and lets you remove entries.
- **Vision.** Attach an image and it reacts to what's in it.
- **Rich output.** Mermaid diagrams and tables are rendered as images.

### Answer Machine
- **Opt-in per channel.** No memory and no per-user history, just a short rolling view of the recent conversation.
- **Decides for itself when to speak.** A fast model rates each moment: an open question, misinformation, something worth reacting to, or nothing.
- **Adjustable chattiness ("heat").** `Low` and `Medium` only answer and correct. `High` and `TalksALot` also join casual conversation.
- **Reactions, GIFs and stickers.** It reacts with emojis, including the server's custom ones. GIFs and stickers are optional.
- **Sees images and short clips** posted in the channel.
- **Separate from chat mode.** A channel in Answer Machine mode never falls back to chat mode, even on a direct mention.

### Live data (both modes)
When fresh information would make an answer correct or more relevant, Nocturnal looks it up. Each tool call shows a status line in chat, for example `✓ get_weather • 1.4s`.

- Web search
- Weather
- Current time and timezones
- Geocoding and reverse geocoding
- Cryptocurrency prices

The model decides when a lookup is worth it. "What's the weather today?" gets a lookup. "I like the weather lately" usually just gets a reply.

### Running it across servers
- **Per-server config.** Each server's admins manage their own channels, Answer Machine settings, rate limits and tools with slash commands, without affecting other servers.
- **Server allowlist.** The bot automatically leaves any server you haven't approved, so a stray invite link can't add it somewhere unexpected.
- **Scheduled notifications.** Daily weather, severe-weather alerts, news digests and NASA's Astronomy Picture of the Day, posted to a channel. This uses an optional companion service.
- **Rate limiting** per user, per minute and per hour, plus a cap on concurrent requests.

---

## Requirements

| Requirement | Notes |
|---|---|
| [Node.js](https://nodejs.org) 20+ | Runtime. Native modules (SQLite) must be built with the same Node version that runs the bot. |
| [Ollama](https://ollama.com) | Model inference. Local or [cloud models](https://ollama.com/cloud) both work. |
| [Ollama-Tools API](https://github.com/Gigg1E/Ollama-Tools) | Provides the live-data tools. Without it the bot still chats, but has no lookups. |
| [ffmpeg](https://ffmpeg.org) (optional) | Lets Answer Machine see GIFs and short video clips frame by frame. Without it, it sees a single preview frame. |
| A Discord application and bot token | From the [Discord Developer Portal](https://discord.com/developers/applications). Enable the **Message Content** and **Server Members** privileged intents. |

### Models

| Purpose | Default | Where it's set |
|---|---|---|
| Chat mode | `kimi-k2.6:cloud` | `ollama.chatModel` in `config.json`, or `/model` |
| Answer Machine | `gemma4:cloud` | `src/services/casualChat.ts` |
| Memory extraction | `gemma4:cloud` | `src/services/memoryExtractor.ts` |

Answer Machine uses a separate, faster model on purpose. It joins conversations that are already happening, so a reply has to arrive in under a second or two to feel natural. A slower, richer model works fine for chat mode, because there the person asked and expects a moment of "thinking".

---

## Setup

### 1. Install

```bash
git clone https://github.com/Gigg1E/Nocturnal-ai.git
cd Nocturnal-ai
npm install
```

### 2. Environment

Copy `.env.example` to `.env` and fill it in:

```env
DISCORD_TOKEN=            # Bot token
OWNER_ID=                 # Your Discord user ID (unlocks owner-only commands like /model)

OLLAMA_HOST=http://127.0.0.1:11434
TOOLS_API_HOST=http://localhost:3100      # Ollama-Tools API
WEBHOOK_API_HOST=http://localhost:3200    # Optional: scheduled-notifications service

KLIPY_API_KEY=            # Optional: GIF search for Answer Machine
```

### 3. Allow your server(s)

Nocturnal leaves any server that isn't on its allowlist (`data/guilds.json`), so add yours before inviting it:

```bash
node scripts/manage-guilds.js add <guildId> "My Server"
node scripts/manage-guilds.js list
```

If the bot was already in the server before you allowlisted it, restart it so its slash commands get registered there.

### 4. Build and run

```bash
npm run build
npm start
```

Use `npm run dev` to run straight from source during development. For a long-running deployment, a process manager like [PM2](https://pm2.keymetrics.io) works well. Rebuild with `npm run build` before restarting after any change.

Slash commands register automatically for every allowlisted server at startup. No separate deploy step is needed.

---

## Configuration

Configuration has three layers:

| Layer | Where | Who controls it | What's in it |
|---|---|---|---|
| Global | `config.json` | Bot host | Default personality (`bot.systemPrompt`), chat model and generation settings, logging, conversation history length |
| Per server | `data/guilds/<guildId>/config.json` | That server's admins, via `/config` and `/channel` | Allowed and blocked channels, Answer Machine channels and heat, GIFs and stickers, rate limits, tools on/off, user blacklist |
| Per user | SQLite (`data/net.db`) | Each user, via `/personality` and `/memory` | Custom personality, remembered facts, usage and rate-limit tracking |

Server and user data are created automatically and kept out of git.

---

## Slash commands

| Command | Who | What it does |
|---|---|---|
| `/help` | Everyone | How to use Nocturnal |
| `/personality` | Everyone | View, set or reset how Nocturnal talks to you |
| `/memory` | Everyone | See what Nocturnal remembers about you, and forget entries |
| `/clearchat` | Everyone | Start the conversation fresh (keeps memory and personality) |
| `/channel` | Admins | Allowed and blocked channels, Answer Machine channels, heat, GIFs and stickers |
| `/config` | Admins | View and change this server's settings |
| `/blacklist` | Admins | Block users from talking to the bot |
| `/stats` | Admins | Usage statistics |
| `/status` | Admins | Live health check of every tool endpoint |
| `/webhook` | Admins | Manage scheduled notifications |
| `/model` | Owner | List, view or switch the chat model |

---

## Architecture

```
Discord ──► discord.js client
              │
              ├─ Chat mode ─────────► Ollama (chat model)
              │    personality + memory + per-user history
              │
              ├─ Answer Machine ────► Ollama (fast model)
              │    rolling channel buffer → decide → reply / react
              │
              ├─ Tool calls (both) ──► Ollama-Tools API   (search, weather, time, geo, crypto)
              ├─ /webhook ───────────► Notifications service (optional)
              ├─ Rendering ──────────► Mermaid / tables → images (Playwright)
              └─ Storage ────────────► SQLite + per-server JSON config
```

The bot doesn't implement tools itself. Every lookup is an HTTP call to the Tools API, which runs as a separate process with its own lifecycle.

---

## License

MIT
