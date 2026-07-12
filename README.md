# Taifa AI

An offline-first AI coding agent that runs entirely on-device in Termux on Android, using Node.js, React, and [Ollama](https://ollama.com). No internet connection or cloud API required after setup.

## Why

Most AI coding tools depend on constant internet access, paid subscriptions, and sending source code to a cloud provider. Taifa AI runs the model, the backend, and the UI all locally.

## Architecture
Browser (React, :3000)
Express backend (:5000)
Ollama (:11434)
qwen2.5-coder-6k custom model (num_ctx 6144, verified stable)

## Features

### Phase 1 — Foundation
- Streaming chat
- Project understanding (auto-indexes workspace, injects relevant context)
- Auto-reindexing via chokidar
- Conversation memory
- Persistent project memory (remember: fact)
- Safe file writing (write to:, edit:) with diff review and backups
- File browser
- Automated bug-fixing (fix this:)
- Documentation generation (document)
- Gated multi-file planning (plan:)

### Phase 2 — Repository Understanding
- Import graph (resolved imports, external tagging, reverse dependencies)
- Function/route index (on-demand, not auto-injected)
- Component graph (JSX render edges derived from imports)
- DB schema graph (Mongoose-style field extraction)
- All (except function index) auto-injected into generation prompts, token-budget capped

### Phase 3 — Execution Engine
- Multi-batch planning: tasks exceeding 5 files start a campaign; remaining files carried forward mechanically, fresh reindex before each batch, next batch auto-proposed but still gated
- Command execution: run tests finds and runs the workspace test suite via sandboxed execFile

### Phase 4 — Tool Ecosystem
- Git Tool: git status, git diff (read-only), commit changes (AI-drafted message, gated approval, refuses to propose if generated/vendor content like node_modules is detected)
- Package Manager Tool: install: <package>, strict npm name validation blocking flag-injection, gated approval

### Phase 5 — Verification Pipeline
- Syntax checking (@babel/parser, JSX-aware)
- Import checking (relative resolution, external dependency verification)
- Lint checking (ESLint, in-memory)
- AI self-review (advisory only, not authoritative)
- Test generation (write tests: path.js) with a hard deterministic module-system mismatch check that refuses guaranteed-crash diffs

### Phase 6 — Human-Supplied Architecture
Full autonomous project building was deliberately ruled out: the local
model cannot reliably hold multi-file architectural coherence, and a
cloud-model hybrid was rejected outright since local-only processing is
a real security requirement, not a preference. Instead, this shifts the
one thing the model is unreliable at (inventing architecture) to the
human, keeping the model doing only what it has shown it can do
reasonably: generate one file's content against a clear description.
- execute plan: <description>, followed by one path: description line
  per file, entered via a multi-line textarea (Enter adds a newline,
  Send submits, since mobile keyboards do not reliably expose Shift+Enter)
- Reuses the exact multi-batch campaign system from Phase 3 unchanged;
  the only new code is a parser producing a file list from human input
  instead of a model call
- Every downstream step is identical to any other plan: generation,
  syntax/import/lint/self-review checks, diff review, batch-by-batch
  approval
- Fixed a real bug found during testing: import checking only ever
  checked against real on-disk state, so a batch creating a new source
  file and its test together would always falsely report the sibling
  import as missing since neither file exists on disk until the whole
  batch is applied. Files proposed together in the same batch are now
  treated as resolvable against each other.

## Setup

Prerequisites: Node.js, npm, and Ollama installed.

Pull the base model:
ollama pull qwen2.5-coder:1.5b

Build the custom higher-context variant (create a Modelfile with FROM qwen2.5-coder:1.5b and PARAMETER num_ctx 6144, then run ollama create qwen2.5-coder-6k -f Modelfile).

Start Ollama: ollama serve

Backend: cd backend, npm install, node server.js

Frontend (separate terminal): cd frontend, npm install, npm start

Open http://localhost:3000.

## Usage

Commands:
- write to: path.js | instruction — propose a new file
- edit: path.js | instruction — propose an edit
- fix this: <error> — locate and propose a fix
- document — generate a workspace README
- plan: <description> — propose a multi-file change, batched if needed
- execute plan: <description> followed by one path: description line per file — human-supplied architecture, batched the same way
- remember: <fact> — store a persistent project fact
- run tests — execute the workspace test suite
- git status / git diff — read-only git inspection
- commit changes — AI-drafted commit message, gated approval
- install: <package> — validated npm install, gated approval
- write tests: path.js — generate a test file for an existing file

Every write, edit, fix, plan, commit, install, and generated test shows a diff or clear proposal with explicit Approve/Reject — nothing is written, committed, or installed without confirmation.

## Safety design

- All file writes are restricted to workspace/, checked against path traversal and symlink escapes both when proposed and again when actually written.
- Writing, committing, and installing are only triggered by explicit commands, never inferred from conversation.
- Every overwrite backs up the previous version first.
- Multi-file plans are all-or-nothing: any path-safety failure mid-apply halts the entire batch.
- Tool execution always uses execFile with a fixed command and argument list, never a shell string.
- Package installs are validated against real npm naming rules before execution, blocking argument-injection attempts.
- Git commits are refused outright if generated or vendor content is detected in what would be staged, independent of gitignore correctness.
- Test generation is refused outright if the generated code would use the wrong module system for its target location.
- AI self-review is advisory only and never blocks or auto-applies anything.
- The agent never takes autonomous multi-step actions without a human approval gate at each step.

## Project structure

backend/
- server.js — Express routes, command dispatch, all handlers
- fileIndexer.js — workspace scanning, indexing, token-budgeted context
- importGraphBuilder.js — import resolution, external tagging, reverse dependencies
- functionIndexBuilder.js — function/route extraction, on-demand
- componentGraphBuilder.js — JSX render edge derivation
- dbSchemaBuilder.js — Mongoose-style schema field extraction
- generateFileContent.js — all model prompt builders and generation functions
- syntaxChecker.js — babel-parser-based validity checking
- importChecker.js — import resolution checking for generated code
- lintChecker.js — ESLint-based issue detection
- selfReviewParser.js — defensive parsing of self-review answers
- moduleSystemDetector.js — deterministic module system detection and mismatch refusal
- testRunner.js — sandboxed npm test execution
- gitTool.js — sandboxed git status/diff/commit, risky-path detection
- packageManagerTool.js — validated npm install execution
- planState.js — single-plan and multi-batch campaign state
- toolActionState.js — generic pending-action gate
- pathSafety.js — traversal and symlink protection
- backupManager.js — pre-overwrite backups
- stripCodeFences.js — markdown fence stripping
- fileTree.js — workspace directory tree
- extractErrorPath.js — stack trace path extraction
- projectMemory.js — persistent fact storage
- various *CommandParser.js files — strict command-trigger parsers

frontend/ — React chat UI
workspace/ — sandbox folder the agent reads from and writes to

## Status

All six phases complete, including a deliberately rescoped Phase 6 (the original fully-autonomous-project-building vision was ruled out as unrealistic and unsafe for a local-only 1.5B model; the human-supplied-architecture version keeps the same safety guarantees while getting real practical value). Actively developed. See commit history for the order features were built and the real bugs found and fixed at each step.

## Known limitations

- Small local model (1.5B params, custom 6144-token context): good for straightforward, well-scoped tasks; demonstrably unreliable at holding cross-file consistency and at reliably following explicit instructions.
- Plan, campaign, and pending tool-action state are held in memory and lost if the server restarts.
- Documentation generation can fabricate plausible-sounding but false technical details. Always review before approving.
- AI self-review is advisory only. It has produced at least one confirmed false positive, flagging genuinely correct code as buggy, and should never be treated as a real safety guarantee.
- Test generation requires close review every time. Even with hard-gated module-system checking, generated tests have contained wrong import paths and wrong export-style assumptions.
- Self-review and test generation both roughly double inference time per diff.
- formatFullIndex's token budget cap protects against context overflow but means large workspaces will have files silently excluded from generation context, visibly flagged in a truncation notice.
