# Taifa AI

An offline-first AI coding agent that runs entirely on-device in Termux on Android, using Node.js, React, and [Ollama](https://ollama.com). No internet connection or cloud API required after setup.

## Why

Most AI coding tools depend on constant internet access, paid subscriptions, and sending source code to a cloud provider. Taifa AI runs the model, the backend, and the UI all locally — useful for unreliable connectivity, cost-sensitive environments, or situations where sending code off-device isn't an option.

## Architecture
Browser (React, :3000)

↓

Express backend (:5000)

↓

Ollama (:11434)

↓

qwen2.5-coder:1.5b (local model)
## Features

- **Streaming chat** — conversational coding help, streamed token-by-token from a local model
- **Project understanding** — indexes the `workspace/` folder and injects relevant file content into prompts automatically, so you can ask things like "where is the login functionality?"
- **Auto-reindexing** — the file index rebuilds automatically (debounced) whenever files in `workspace/` change, via `chokidar`
- **Conversation memory** — the last few turns of a chat are sent back as context, so follow-up questions work
- **Persistent project memory** — explicitly tell it to remember facts about your project (`remember: this project uses Firebase`), and those facts get included in every future prompt, capped at 20 facts with oldest-first eviction
- **Safe file writing** — explicit commands (`write to: path.js | instruction` or `edit: path.js | instruction`) generate file content, which you review as a side-by-side diff and explicitly approve or reject before anything touches disk. Every overwrite is backed up first.
- **File browser** — a collapsible tree view of the `workspace/` folder in the UI

## Setup

**Prerequisites:** Node.js, npm, and [Ollama](https://ollama.com) installed.

```bash
# Pull the model
ollama pull qwen2.5-coder:1.5b
ollama serve

# Backend
cd backend
npm install
npm run dev   # via nodemon, auto-restarts on changes

# Frontend (separate terminal)
cd frontend
npm install
npm start
```

Open `http://localhost:3000`.

## Usage

**Normal chat:**
**Ask about your project** (automatically searches `workspace/`):
**Remember a project fact:**
**Write a new file:**
**Edit an existing file:**
Every write or edit shows a before/after diff with **Approve**/**Reject** buttons — nothing is written to disk without explicit confirmation.

## Safety design

- All file writes are restricted to the `workspace/` folder. Paths are resolved and checked against path traversal (`../`) and symlink escapes before any write is attempted.
- Writing is **only** triggered by an explicit `write to:` / `edit:` command — never inferred automatically from conversation.
- Every overwrite backs up the previous version before writing.
- No autonomous multi-step actions. Every change requires human review and approval.

## Project structure
backend/      Express server, file indexing, write pipeline

frontend/     React (Create React App) chat UI

workspace/    Sandbox folder the agent reads from and writes to

docs/         (reserved)

models/       (reserved)

scripts/      (reserved)
## Status

Actively developed. Built incrementally and tested at each layer — see commit history for the order features were added.

## Known limitations

- Small local model (1.5B params) — good for straightforward tasks, not a substitute for a larger cloud model on complex reasoning
- 4096-token context window shared across conversation history, file context, and project memory
- No multi-file write operations yet (one file per command)
- No automated bug-fixing workflow yet (model can discuss errors, but doesn't yet automatically locate and patch the relevant file from a stack trace)
