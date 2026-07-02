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
- **Safe file writing** — explicit commands (`write to: path.js | instruction` or `edit: path.js | instruction`) generate file content, which you review as a before/after diff and explicitly approve or reject before anything touches disk. Every overwrite is backed up first.
- **File browser** — a collapsible tree view of the `workspace/` folder in the UI
- **Automated bug-fixing** — paste an error or stack trace with `fix this: <error>` and the agent locates the relevant file (via stack trace path extraction first, keyword search as fallback), generates a fix, and shows it as a diff for your review before applying
- **Documentation generation** — type `document` to scan the entire workspace and generate a README.md, proposed as a diff so you can review and approve before it's written. Includes a visible warning since small models sometimes fabricate technical details not present in the code.
- **Gated multi-file planning** — type `plan: <description>` to propose a multi-file change. The agent generates a plan (up to 5 files), you review and approve the plan, it then generates diffs for each file, you review all diffs together, and only on explicit approval are all files written. All-or-nothing: approving writes all files, rejecting writes none.

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
**Fix a bug:**
**Generate documentation:**
**Plan a multi-file change:**
Every write, edit, fix, documentation proposal, and multi-file plan shows a before/after diff with explicit **Approve**/**Reject** buttons — nothing is written to disk without your confirmation.

## Safety design

- All file writes are restricted to the `workspace/` folder. Paths are resolved and checked against path traversal (`../`) and symlink escapes before any write is attempted. This check runs again at the point of writing, not just at the point of proposing.
- Writing is **only** triggered by explicit commands — never inferred automatically from conversation.
- Every overwrite backs up the previous version before writing.
- Multi-file plans are all-or-nothing: if any file fails a path-safety check mid-apply, the entire batch halts.
- The agent never takes autonomous multi-step actions without human review and approval at each gate.

## Project structure
Every write, edit, fix, documentation proposal, and multi-file plan shows a before/after diff with explicit **Approve**/**Reject** buttons — nothing is written to disk without your confirmation.

## Safety design

- All file writes are restricted to the `workspace/` folder. Paths are resolved and checked against path traversal (`../`) and symlink escapes before any write is attempted. This check runs again at the point of writing, not just at the point of proposing.
- Writing is **only** triggered by explicit commands — never inferred automatically from conversation.
- Every overwrite backs up the previous version before writing.
- Multi-file plans are all-or-nothing: if any file fails a path-safety check mid-apply, the entire batch halts.
- The agent never takes autonomous multi-step actions without human review and approval at each gate.


backend/      Express server, file indexing, write pipeline, plan state
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
- Documentation generation can fabricate plausible-sounding but false technical details (e.g. libraries not actually used in the code). Always review the generated diff carefully before approving.
- Multi-file planning state is held in memory and lost if the server restarts — you would need to re-trigger the plan
- `formatFullIndex()` (used for documentation generation) has no size cap and will exceed the model's context window on a large workspace; fine at current project size
