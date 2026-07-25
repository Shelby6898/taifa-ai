# Taifa AI

An offline-first AI coding agent that runs entirely on-device in Termux on Android, using Node.js, React, and [Ollama](https://ollama.com). No internet connection or cloud API required after setup.

## Why

Most AI coding tools depend on constant internet access, paid subscriptions, and sending source code to a cloud provider. Taifa AI runs the model, the backend, and the UI all locally.

## Architecture
Browser (React, :3000)
Express backend (:5000)
Ollama (:11434)
qwen2.5-coder:3b (3.1B params, 32768 max context; no custom num_ctx set, so it runs at Ollama's built-in runtime default rather than the model's max)

## Features

### Phase 1 — Foundation
- Streaming chat
- Project understanding (auto-indexes workspace, injects relevant context)
- Auto-reindexing via chokidar
- Conversation memory
- Persistent project memory (remember: fact)
- Safe file writing (write to:, edit:) with diff review and backups
  - edit: uses scoped SEARCH/REPLACE patching rather than regenerating
    the whole file: the model proposes one or more targeted blocks,
    each is matched verbatim against the real file and applied
    independently. Blocks that succeed are applied; blocks that fail
    (ambiguous or non-matching SEARCH text) are skipped and reported
    rather than discarding the whole edit, unless every block fails,
    in which case the edit is refused outright. Any reported
    per-block failures are surfaced to the reviewer alongside the diff.
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
- Mechanical test-suite verification: the existing test suite is run
  against the proposed content before it can be approved, replacing
  AI self-review (which proved structurally unreliable — it missed a
  real regression and hallucinated fake issues in testing, and is no
  longer called anywhere in the pipeline)
- Route regression checking (regressionChecker.js): compares Express
  route registrations between the current and proposed file version
  to catch silently dropped routes or middleware; hard-refuses at the
  single-file write/edit/fix routes, warning-only in the batch-plan loop
- package.json checking (packageJsonChecker.js): catches undeclared
  require()/import calls not reflected in package.json, and verifies
  any package version named in a proposed package.json actually
  exists on the npm registry
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

Pull the model:
ollama pull qwen2.5-coder:3b

No custom Modelfile is required — the code points directly at qwen2.5-coder:3b, which runs at Ollama's built-in runtime default context rather than an explicitly set num_ctx.

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
- selfReviewParser.js — defensive parsing of self-review answers (retained for reference; no longer called anywhere in the pipeline, superseded by mechanical test-suite verification)
- searchReplaceParser.js — parses model output into SEARCH/REPLACE blocks and applies each independently against the real file, reporting per-block success/failure rather than all-or-nothing
- regressionChecker.js — compares Express route registrations between file versions to catch silently dropped routes or middleware
- packageJsonChecker.js — catches undeclared require()/import calls and hallucinated npm package versions
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

All six phases complete, including a deliberately rescoped Phase 6 (the original fully-autonomous-project-building vision was ruled out as unrealistic and unsafe for a local-only 1.5B model; the human-supplied-architecture version keeps the same safety guarantees while getting real practical value). Since then, the verification pipeline has been hardened further: AI self-review was removed in favor of mechanical test-suite verification after proving structurally unreliable in testing, route regression checking and package.json checking were added as additional gates, and edit: was rebuilt on scoped SEARCH/REPLACE patching with per-block partial-application instead of full-file regeneration. Actively developed. See commit history for the order features were built and the real bugs found and fixed at each step.

## Known limitations

- Small local model (qwen2.5-coder:3b, 3.1B params, running at Ollama's default context rather than an explicitly set num_ctx): good for straightforward, well-scoped tasks; demonstrably unreliable at holding cross-file consistency and at reliably following explicit instructions.
- Plan, campaign, and pending tool-action state are held in memory and lost if the server restarts.
- Documentation generation can fabricate plausible-sounding but false technical details. Always review before approving.
- AI self-review was removed after proving structurally unreliable (it missed a real regression and hallucinated fake issues in testing); mechanical test-suite verification, route regression checking, and package.json checking now serve this role instead.
- The model is inconsistent at reliably producing well-formed SEARCH/REPLACE blocks for edit:. Observed failure modes across live testing include: dropping the required markers, wrapping output in markdown fences despite instructions not to, copying SEARCH text that doesn't match the file verbatim (stale or paraphrased), and cross-contaminating details between two structurally similar blocks. When every block in a request fails, the edit is refused outright; when only some fail, the ones that succeeded are still applied and the failures are reported for review.
- Test generation requires close review every time. Even with hard-gated module-system checking, generated tests have contained wrong import paths and wrong export-style assumptions.
- Self-review and test generation both roughly double inference time per diff.
- formatFullIndex's token budget cap protects against context overflow but means large workspaces will have files silently excluded from generation context, visibly flagged in a truncation notice.
