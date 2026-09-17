# Taifa AI

An offline-first AI coding agent that runs entirely on-device in Termux on Android, using Node.js, React, and [Ollama](https://ollama.com). No internet connection or cloud API required after setup.

## Why
Most AI coding tools depend on constant internet access, paid subscriptions, and sending source code to a cloud provider. Taifa AI runs the model, the backend, and the UI all locally.

## Architecture
Browser (React, :3000)
Express backend (:5000)
Ollama (:11434)
qwen2.5-coder:3b (3.1B params, 32768 max context; no custom num_ctx set, so it runs at Ollama's built-in runtime default rather than the model's max)
PostgreSQL (local, `taifa_ai` database) — durable, relational state: project memory facts, conversation history, plans and multi-batch campaigns. Session-derived caches (file index, import/component/DB-schema graphs) stay on disk as JSON, rebuilt from source rather than treated as source of truth.

The backend is multi-tenant: every request is scoped to a session key (`studentId:projectName`), and each student's project gets its own workspace directory (`workspace/<studentId>/<projectName>/`), its own file index and dependency graphs, its own file watcher (created on first use, closed after 25 minutes idle, transparently recreated on next use), and its own conversation history — all fully isolated from every other student and every other project. See the Phase 6 section below for the full breakdown.

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

### Phase 6 — Human-Supplied Architecture, Multi-Tenancy, and Persistence

**Human-supplied architecture.** Full autonomous project building was deliberately ruled out: the local model cannot reliably hold multi-file architectural coherence, and a cloud-model hybrid was rejected outright since local-only processing is a real security requirement, not a preference. Instead, this shifts the one thing the model is unreliable at (inventing architecture) to the human, keeping the model doing only what it has shown it can do reasonably: generate one file's content against a clear description.
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

**Multi-tenancy conversion.** The system originally ran as a single-tenant tool: one shared workspace directory, one set of in-memory state variables, used by whoever happened to be hitting the server. This was rebuilt from the ground up to support many students using the same running server concurrently, with every layer fully isolated:
- Session identity: every request resolves to a `studentId:projectName` key (sanitized, derived from the authenticated JWT and a student-chosen project name), created lazily on first use — no roster or pre-provisioning step required.
- State isolation: `clarificationState.js`, `planState.js`, and `toolActionState.js` were converted from bare global singletons to `Map`s keyed by session, so two students' in-progress clarification questions, pending plans, and pending tool actions (git commit, npm install) can never collide or leak into each other.
- Filesystem isolation: `workspaceResolver.js` is the single source of truth resolving a session key to a real, per-student, per-project directory (`workspace/<studentId>/<projectName>/`). `fileIndexer.js` was rebuilt to index and watch each active student's workspace independently — `ensureWatching(sessionKey)` creates a real `chokidar` watcher on first use, and an idle-teardown sweep closes watchers after 25 minutes of inactivity (transparently recreated on the student's next request) so memory use stays bounded to students actually active right now rather than growing forever on a phone-hosted server. `pathSafety.js` and `backupManager.js`, plus the ten files that previously imported a single shared `WORKSPACE_DIR` constant (import/function/component/DB-schema graph builders, git tool, package manager tool, test runner, and others), were all converted to resolve their own student's workspace instead of one global path.
- `/api/projects` (new): lists a student's existing projects, backing a project-selector dropdown in the frontend topbar (with a "+ New Project" option) so a student can work on multiple distinct projects concurrently, fully separated from each other.
- Real bugs caught during this conversion, all found by testing the running system rather than reading the code back: a cross-project memory leak in `projectMemory.js` (a brand-new project was inheriting facts from an unrelated earlier one), a missed session-key parameter in the plan-generation path, leftover duplicate code from an imprecise multi-line find-and-replace, a completely hardcoded legacy workspace path hiding inside the fix-command handler, and the discovery that the browser's `fetch()` API cannot send a body on a GET request (unlike curl, which let earlier manual tests pass even though the same code would fail for real in a browser) — fixed generally by having session resolution accept the project name as a URL query parameter too, not just a request body field.

**Refresh recovery.** Originally, refreshing the browser mid-task (mid-clarification-question, mid-diff-review, mid-blueprint-approval) lost the pending action entirely, even though the server-side state for it still existed. A new `GET /api/session/current` endpoint checks pending tool actions, pending plans/diffs, pending single-file writes, and clarification state (across all its phases: question, requirements summary, architecture check, blueprint) in priority order and returns whichever one is actually outstanding, letting the frontend reconstruct the exact panel a student was about to act on. This required adding a new `pendingWriteState.js` module (single-file write/fix/test-generation proposals previously had no backing state at all — they were computed and returned in one response, then the backend forgot about them completely) and a matching `/api/write/reject` endpoint, since approval already existed but rejection previously only cleared client-side state.

**Server-stored, per-project conversation history.** Chat scrollback previously lived only in browser memory — a refresh wiped the entire conversation, not just the pending action. `conversationHistory.js` persists every turn to a per-session JSON file on disk. The server intercepts its own `res.json` calls within the `/api/chat` handler chain to automatically persist every JSON-mode response without needing a manual save call at each of the ~40 response sites across the handler's sub-functions; the free-form streaming chat path (plain conversational replies, not a specific command) required a separate fix, accumulating the full streamed reply and persisting it once the stream completes. `buildFullPrompt` now reads this server-side history for model context instead of trusting whatever the client claims to have sent. A new `GET /api/chat/history` endpoint lets the frontend replay a project's full conversation on load. To avoid ever having two different pieces of code decide what a message should look like (and drift apart over time), the frontend's inline message-formatting logic was extracted into one shared function used both for live messages and for replaying stored history.
- Real bugs found and fixed here too: a chunk-boundary bug in the streaming handler — the original code parsed each network chunk independently, silently dropping any JSON line split across a chunk boundary (a real risk over an actual network connection, invisible when testing via curl's cleaner buffering) — fixed with a persistent buffer spanning chunks, a completion guard against double-finishing the response, and a check for whether streaming headers were already sent before attempting to send a JSON error response instead (which throws in Node/Express if headers are already committed); and a history-replay bug where the shared formatter was missing the response's action type for one specific response shape, since that field lived as a sibling of the stored data rather than nested inside it.

**UI polish.** The frontend already had a well-built design-token system and dedicated visual panels for most pending-action types (proposed writes, proposed plans, diff review, tool-action approval) that had simply never been wired up for the architecture-blueprint step — it was rendering as one flattened paragraph of joined text. Rebuilt as a proper structured panel (frontend/backend/database/authentication/storage/collections/modules/estimated files as labeled fields) with a matching approve action, consistent with every other pending-action panel in the app.

### Phase 7 — Persistent Storage Migration and Deeper Validator Coverage

**PostgreSQL migration.** Project memory facts, conversation history, and plan/campaign state previously lived as one JSON file per session per data type — durable across restarts, but with no partial-update safety (a full read-modify-rewrite of the whole file on every change), no relational integrity between students/projects/plans beyond a filename convention, and no way to query across sessions. `projectMemory.js`, `conversationHistory.js`, and `planState.js` were rewritten against a real PostgreSQL schema (`students`, `projects`, `conversation_messages`, `project_memory_facts`, `plans`, `plan_campaigns`), reached through a small connection-pool module (`db.js`) and a `getOrCreateProjectId(sessionKey)` helper (`projectResolver.js`) that lazily creates student/project rows the same way the old system lazily created files. Every table was designed against the actual source code and actual on-disk JSON shapes rather than assumed, including two corrections to earlier documentation this process itself surfaced: `getWorkspaceDir` does not create a workspace directory (a separate function, `ensureWorkspace`, does — see the `pathSafety.js` fix below), and `planState.js` does persist to disk on every write rather than being purely in-memory. Session-derived caches (file index, import/component/DB-schema graphs) deliberately stayed as JSON — they're rebuilt from source code, not a system of record, so Postgres's guarantees don't add anything there.
- The old 20-fact FIFO cap and exact-match dedup on project memory facts were deliberately dropped, not carried over — the cap only existed to bound a single JSON file's size, a constraint Postgres removes entirely; facts are now kept permanently.
- Plans and campaigns previously vanished from disk the moment they were applied or rejected (`fs.unlinkSync`). They're now marked with a permanent `resolution` (`applied`/`rejected` for plans; `completed`/`rejected`/`failed` for campaigns) and a timestamp instead of being deleted, so a project's plan history survives — a genuine improvement over the old file-based behavior, not just a like-for-like port.
- A real bug was found and fixed during the migration itself: the old code let one part of the pipeline mutate a `codeValidationIssues` field directly onto an in-memory plan object after it had already been persisted, relying on JavaScript's object-reference semantics to make the mutation "stick" for the rest of that server session — invisible as a bug until Postgres removed the shared-mutable-reference trick that had been silently papering over it (the field was never actually being saved to disk in the old system either). Fixed by threading `codeValidationIssues` through as a real parameter that gets persisted in the same write, rather than bolted on afterward.

**Deeper `codeValidator.js` coverage.** Reviewing a real generated batch (a set of Sequelize models and their routes) surfaced two further gaps, added as new checks: a model file that exports the Sequelize model directly (`module.exports = sequelize.define(...)`) getting destructured elsewhere (`const { User } = require(...)`) instead of assigned directly, silently binding `undefined`; and a model file requiring a relative database-connection module (`../db`, `../database`, `../sequelize`, `../connection`) that doesn't actually exist yet anywhere the validator can see. The second check is deliberately conservative about what "doesn't exist" means: existence is checked against the real workspace on disk, not just the files in the current batch, specifically so a connection module legitimately created in an earlier batch isn't falsely flagged. `codeValidator.js` now runs 11 checks in total (see Project structure below), all following the same house rule the file states at its own top: deterministic regex/string checks only, and every check traces back to a real bug found by reviewing actual generated diffs, not a hypothetical one.

**Workspace-creation bug in `pathSafety.js`.** A project whose workspace only ever had plan/chat/memory activity — never an actual file write — would throw `ENOENT` the first time a plan was approved, because `isPathSafe` called `getWorkspaceDir` (which only builds a path string) and then immediately ran an unguarded `fs.realpathSync` on a directory that had never actually been created. The very next line in the same function already handled this exact scenario correctly for a path's parent directory; the fix was to call `ensureWorkspace` (which actually creates the directory) at that one call site instead.

**Project-deletion cleanup.** Deleting a project previously only cleared its project-memory facts; conversation history and any plan or campaign state were left behind indefinitely, including a plan that was never resolved at all becoming permanently stuck pending for a project that no longer existed anywhere. Project deletion now also deletes all conversation history (it has no independent value once the project is gone) and resolves any still-open plan or campaign to a new `project_deleted` outcome — already-resolved plan/campaign history is untouched, preserving the permanent record described above.

## Setup

Prerequisites: Node.js, npm, and Ollama installed.

Pull the model:
ollama pull qwen2.5-coder:3b

No custom Modelfile is required — the code points directly at qwen2.5-coder:3b, which runs at Ollama's built-in runtime default context rather than an explicitly set num_ctx.

Start Ollama: ollama serve

Backend: cd backend, npm install, node server.js

Frontend (separate terminal): cd frontend, npm install, npm start

Open http://localhost:3000, log in, and pick or create a project from the topbar dropdown.

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

Every write, edit, fix, plan, commit, install, and generated test shows a diff or clear proposal with explicit Approve/Reject — nothing is written, committed, or installed without confirmation. Refreshing the browser mid-task, or switching away and back, restores both the full conversation and any pending action still awaiting a decision.

## Safety design

- All file writes are restricted to a student's own workspace, checked against path traversal and symlink escapes both when proposed and again when actually written, against that specific student's resolved workspace root.
- Writing, committing, and installing are only triggered by explicit commands, never inferred from conversation.
- Every overwrite backs up the previous version first, into a per-student, per-project backup directory.
- Multi-file plans are all-or-nothing: any path-safety failure mid-apply halts the entire batch.
- Tool execution always uses execFile with a fixed command and argument list, never a shell string.
- Package installs are validated against real npm naming rules before execution, blocking argument-injection attempts.
- Git commits are refused outright if generated or vendor content is detected in what would be staged, independent of gitignore correctness.
- Test generation is refused outright if the generated code would use the wrong module system for its target location.
- AI self-review is advisory only and never blocks or auto-applies anything.
- The agent never takes autonomous multi-step actions without a human approval gate at each step.
- Every student's session, state, files, and conversation history are fully isolated from every other student's — verified live under genuinely concurrent requests, not just sequential ones.
- Deleting a project deletes its workspace, memory, conversation history, and backups, and resolves any still-open plan or campaign to a permanent `project_deleted` outcome rather than leaving it dangling; already-resolved plan history is left untouched.

## Project structure

backend/
- server.js — Express routes, command dispatch, all handlers
- sessionKey.js — resolves and sanitizes a request's `studentId:projectName` session key, ensures that session's file watcher is alive
- sanitize.js — the shared sanitization primitive used by session keys and workspace paths, extracted to its own module to avoid a circular dependency
- workspaceResolver.js — resolves a session key to a real per-student, per-project workspace directory; lists a student's existing projects
- fileIndexer.js — per-session workspace scanning, indexing, token-budgeted context, and file-watcher lifecycle (creation, idle teardown, transparent recreation)
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
- codeValidator.js — 11 deterministic checks against a completed batch of generated code (ORM mismatch, unimported model usage, model bypass, field-reference mismatch, unresolved model paths, direct factory require, barrel require without destructuring, undefined association targets, frontend/backend response mismatches, destructured plain exports, missing database connection modules); every check traces back to a real bug found by reviewing actual generated diffs
- moduleSystemDetector.js — deterministic module system detection and mismatch refusal
- testRunner.js — sandboxed npm test execution
- gitTool.js — sandboxed git status/diff/commit, risky-path detection
- packageManagerTool.js — validated npm install execution
- db.js — PostgreSQL connection pool
- projectResolver.js — resolves a session key to a real Postgres `projects.id`, lazily creating student/project rows
- planState.js — per-project plan and multi-batch campaign state, persisted to PostgreSQL (`plans`, `plan_campaigns`); resolved plans/campaigns keep a permanent record (`applied`/`rejected`/`completed`/`failed`/`project_deleted`) rather than being deleted
- toolActionState.js — per-session pending-action gate (git commit, npm install)
- pendingWriteState.js — per-session pending single-file write/fix/test-generation state, backing refresh recovery
- conversationHistory.js — per-project conversation history, persisted to PostgreSQL (`conversation_messages`)
- pathSafety.js — traversal and symlink protection, scoped to each student's own workspace
- backupManager.js — pre-overwrite backups, scoped per student and project
- stripCodeFences.js — markdown fence stripping
- fileTree.js — per-session workspace directory tree
- extractErrorPath.js — stack trace path extraction
- projectMemory.js — per-project fact storage, persisted to PostgreSQL (`project_memory_facts`); facts are kept permanently, no eviction cap
- various *CommandParser.js files — strict command-trigger parsers

frontend/ — React chat UI, with a project-selector dropdown and a set of dedicated visual panels (write, plan, diffs, blueprint, tool-action) for every pending decision a student needs to review

workspace/<studentId>/<projectName>/ — the per-student, per-project sandbox folder the agent reads from and writes to

## Status

All seven phases complete, including a deliberately rescoped Phase 6 (the original fully-autonomous-project-building vision was ruled out as unrealistic and unsafe for a local-only 1.5B model; the human-supplied-architecture version keeps the same safety guarantees while getting real practical value). Phase 6 has since grown to include a full multi-tenancy conversion (session isolation at every layer: state, filesystem, watchers, backups), a refresh-recovery system, server-stored per-project conversation history, and the UI work to support all of it — turning the tool from something that could only safely serve one person at a time into one that can serve a whole class of students concurrently. Before that, the verification pipeline was hardened: AI self-review was removed in favor of mechanical test-suite verification after proving structurally unreliable in testing, route regression checking and package.json checking were added as additional gates, and edit: was rebuilt on scoped SEARCH/REPLACE patching with per-block partial-application instead of full-file regeneration. Phase 7 moved persistent state (project memory, conversation history, plans and campaigns) from per-session JSON files to PostgreSQL, added two more codeValidator checks found during that work, and fixed a real workspace-creation bug and a project-deletion cleanup gap along the way. Actively developed. See commit history for the order features were built and the real bugs found and fixed at each step.

## Known limitations

- Small local model (qwen2.5-coder:3b, 3.1B params, running at Ollama's default context rather than an explicitly set num_ctx): good for straightforward, well-scoped tasks; demonstrably unreliable at holding cross-file consistency and at reliably following explicit instructions.
- Plan, campaign, pending tool-action, and pending single-file-write state
Documentation generation can fabricate plausible-sounding but false technical details. Always review before approving.
- AI self-review was removed after proving structurally unreliable (it missed a real regression and hallucinated fake issues in testing); mechanical test-suite verification, route regression checking, and package.json checking now serve this role instead.
- The model is inconsistent at reliably producing well-formed SEARCH/REPLACE blocks for edit:. Observed failure modes across live testing include: dropping the required markers, wrapping output in markdown fences despite instructions not to, copying SEARCH text that doesn't match the file verbatim (stale or paraphrased), and cross-contaminating details between two structurally similar blocks. When every block in a request fails, the edit is refused outright; when only some fail, the ones that succeeded are still applied and the failures are reported for review.
- Test generation requires close review every time. Even with hard-gated module-system checking, generated tests have contained wrong import paths and wrong export-style assumptions.
- Self-review and test generation both roughly double inference time per diff.
- formatFullIndex's token budget cap protects against context overflow but means large workspaces will have files silently excluded from generation context, visibly flagged in a truncation notice.
- Idle file watchers are torn down after 25 minutes of inactivity and transparently recreated on a student's next request; this bounds memory use but means the very first request after a long idle period pays a small reindexing cost.
