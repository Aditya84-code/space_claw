# 🦾 Space Claw — Level 2: Persistent Memory

A lean, secure, fully-understood personal AI agent for Telegram. Built from scratch — not a fork.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Create your .env
```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Message [@BotFather](https://t.me/BotFather) on Telegram |
| `ALLOWED_USER_ID` | Message [@userinfobot](https://t.me/userinfobot) on Telegram |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

### 3. Run
```bash
npm run dev
```

---

## Architecture — Level 2

```
src/
  index.ts     — Entry point, graceful shutdown
  config.ts    — Zod-validated env (exits on missing secrets)
  logger.ts    — Structured, colored, level-filtered console logger
  memory.ts    — SQLite persistent memory (conversation history + notes + FTS5)
  bot.ts       — GrammY Telegram bot (whitelist middleware, DB-backed history)
  agent.ts     — Agentic loop (LLM ↔ tools, max iterations cap)
  tools/
    index.ts   — Tool registry + dispatcher
    echo.ts    — Demo tool
    remember.ts — Save a named note to persistent memory
    recall.ts  — Full-text search over saved notes (FTS5)
```

### SQLite Schema

```sql
messages(id, chat_id, role, content, ts)   -- conversation history
notes(id, title, body, ts)                 -- persistent notes
notes_fts                                  -- FTS5 virtual table over notes
```

### Agentic Loop

```
User message
    │
    ▼
OpenAI (gpt-4o)
    │
    ├─ tool_calls? ──► execute() ──► results back to LLM ──┐
    │                                                        │
    └─ plain text reply ◄────────────────────────────────--─┘
         (or max-iterations warning)
```

### Security Model

| Guarantee | Implementation |
|---|---|
| Whitelist | Every update filtered by `ALLOWED_USER_ID` — unknown users silently dropped |
| No web server | GrammY long-polling only, zero open ports |
| Secrets in .env | Zod schema rejects startup if any secret is missing |
| Runaway loop protection | `AGENT_MAX_ITERATIONS` cap (default: 10) |
| No third-party code | No community skills — MCP integrations only (Level 4) |

---

## Available Commands

| Command | Description |
|---|---|
| `/start` | Welcome message |
| `/status` | Show model, history length, note count, config |
| `/clear` | Wipe conversation history (notes are preserved) |
| `/memory` | Browse all saved notes |

---

## Levels Roadmap

| Level | Feature | Status |
|---|---|---|
| 1 | Foundation | ✅ Done |
| 2 | Persistent memory (SQLite + FTS5) | ✅ Done |
| 3 | Voice (Whisper + ElevenLabs) | 🔜 |
| 4 | Real tools via MCP | 🔜 |
| 5 | Proactive heartbeat | 🔜 |

---

## Development

```bash
npm run dev       # tsx watch — hot reloads on save
npm run typecheck # tsc --noEmit — type check only
```
