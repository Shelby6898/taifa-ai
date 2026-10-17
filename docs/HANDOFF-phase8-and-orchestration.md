# Handoff: Multi-Agent Orchestration + Phase 8 Project Memory

Written at the end of a long session (2026-10-13/14/15/16) that fixed 13+
bugs, added a fix-agent feature, startup scripts, 29 new tests, and
campaign resume/retry. Full history: commits from `9438039` through
`9f621b4` on `master`. This doc is the starting point for the NEXT piece
of work, requested but deliberately not started tonight due to session
fatigue (see "Why this wasn't started tonight" below).

## The two things requested

1. **Multi-agent orchestration**: wire Planner → Coder → Test agent →
   Security agent → Documentation → Deployment into one connected
   pipeline, all the way through.
2. **Phase 8 — Project memory**: a persistent store of project
   knowledge — architecture, coding style, preferred libraries, known
   bugs, past decisions, future plans — and critically, **why** a
   decision was made, not just what it was.

## Why this wasn't started tonight

Three real mistakes happened in the last ~90 minutes of the session,
all the same class of error: guessing at line numbers for `sed`
insertions instead of verifying first, resulting in duplicate/missing
closing braces that crashed the server three separate times
(`planState.js` and `generateFileContent.js`). Also one git mishap:
an `--amend` accidentally merged two unrelated commits (an auth
refactor and the fix-agent work) before it was caught and split back
apart. Starting a multi-week architectural feature in that state was
judged too risky. Rule for next session: after ANY multi-line `sed -i`
insertion, immediately run `node -e "require('./file.js')"` (not just
`node -c`) to prove the export actually resolves, before doing
anything else with that file. `node -c` only checks syntax, not that
functions ended up in the right scope.

## Current system state (what exists to build on)

### Pipeline today, Phase 1-7 (see README.md in repo root for full detail)

Single-model (`qwen2.5-coder-3b-6k` via Ollama), human-gated, mostly
linear: `plan:` → clarification → blueprint confirmation → plan
generation (`generateBatchPlan`) → human approves → diff generation
(`/api/plan/approve`, runs syntax/import/lint/test/regression/
undeclared-deps/codeValidator checks) → human approves diffs →
`/api/plan/apply` writes files → if more files remain in a multi-batch
campaign, loop back to diff generation for the next batch.

There is no concept of separate "agents" today — one model, called
with different prompts for different purposes (`buildPlanPrompt`,
`buildGenerationPrompt`, `buildFixPrompt`/`buildFullFileFixPrompt`,
`buildBlueprintPrompt`, `buildTestGenerationPrompt`, `buildDocumentPrompt`
via `handleDocumentCommand`). "Orchestration" would mean formalizing
these into named stages with their own state/hand-off, not necessarily
different models — check whether the person wants literally separate
model instances/roles, or just better-named/better-connected stages of
what already exists. **Ask this before designing anything** — it
changes the scope a lot.

### Relevant existing modules to read first, in this order

1. `backend/planState.js` — the `plans` and `plan_campaigns` tables and
   their lifecycle. Any orchestration almost certainly extends this
   schema rather than replacing it. `recordBatchCompletion` /
   `recordBatchRejection` / `takeNextBatch` are the batch-advance
   primitives already built tonight.
2. `backend/server.js` — `generateBatchPlan`, `/api/plan/approve`,
   `/api/plan/apply`, `/api/plan/fix-file` (new tonight) show the
   current closest thing to a "handoff": plan → diffs → apply, each a
   separate HTTP round-trip gated by human approval.
3. `backend/generateFileContent.js` — every `build*Prompt` function is
   effectively today's "agent" (planner = `buildPlanPrompt`, coder =
   `buildGenerationPrompt`/`buildFullFileFixPrompt`, test agent =
   `buildTestGenerationPrompt`, docs = the prompt inside
   `handleDocumentCommand` in server.js). No existing "security agent"
   — would be new. `codeValidator.js`'s 11 checks are the closest
   existing thing to automated security/correctness review, but it's
   deterministic pattern-matching, not model-based.
4. `backend/projectMemory.js` — Phase 7's existing persistent fact
   store (`project_memory_facts` table, `addFact`/`formatMemoryBlock`).
   This is the direct predecessor to Phase 8 and should probably be
   extended, not replaced. Currently stores flat facts (e.g. "React
   frontend, Node.js backend, PostgreSQL database"), no structure for
   "why", no categories (architecture vs. coding-style vs. known-bug),
   no way to query by category.
5. `backend/architectureContract.js` / `architectureContentValidator.js`
   — the existing structured representation of "architecture" as
   agreed with a human (database, framework, entities, terminology).
   Phase 8's "architecture" memory category likely wraps or extends
   this rather than inventing a new shape.

### Testing infrastructure available (built tonight)

`npm test` in `backend/` runs 54 tests via Node's built-in `node:test`
(`node --test *.test.js`). Pure, stateless logic is testable directly.
**`planState.js` (and anything needing Postgres) has NO test coverage
and no mocking pattern exists in this codebase yet** — this will
become a real gap once orchestration/memory add more DB-backed logic.
Worth deciding early: introduce a `pg` mock (e.g. `pg-mem` or a hand-
rolled fake pool), or accept DB logic stays integration-tested only
via live server + live Postgres (slower, less automated).

### Known model limitation, relevant to any new "agent" design

The local 3B model (`qwen2.5-coder-3b-6k`, CPU-only on-device) is
reliable at full-file generation (new files, full regeneration) and
unreliable at scoped/patch-style edits requiring verbatim text
matching — confirmed by 4 failed SEARCH/REPLACE fix attempts tonight
vs. 1/1 success switching the fix-agent to full-file regeneration
(commit `9f621b4`). Any new "agent" that needs to modify existing code
(e.g. a security agent patching a vulnerability) should default to
full-file regeneration, not a diff/patch format, unless proven
otherwise. A "bigger model" option exists on-device
(`qwen2.5-coder-6k` at 1.5B — smaller, or check for other installed
models via `ollama list`) but swapping models per-agent-role is an
open design question, not yet decided.

## Open design questions for the orchestration work (answer before coding)

- Are "agents" separate model calls with distinct system prompts (like
  today), or does the person want actual separate model
  instances/weights per role?
- Does orchestration replace the human-approval gates at each stage,
  or run underneath them (e.g. security agent reviews BEFORE the human
  sees the diff, feeding into `codeValidationIssues` the same way
  `codeValidator.js` does today)?
- What triggers the "security agent" and "documentation agent" stages
  — automatically after every batch, only on request, or only for
  certain file types?
- Does "deployment" mean literally running a deploy command/script, or
  just generating deployment config/docs? (Scope check: this repo runs
  on-device in Termux — what would "deployment" even target?)

## Open design questions for Phase 8 project memory (answer before coding)

- Schema shape: a single `project_memory_facts` table with a `category`
  column (architecture/style/library/bug/decision/plan), or separate
  tables per category? Favor the simpler single-table-with-category
  approach unless a concrete need for separate tables emerges.
- "Why a decision was made" — is this captured by storing the human's
  own words (what they typed when making the decision, like
  `plan.description` already does for architecture) or does it need
  the model to generate a summary of its own reasoning? The former is
  much safer (no hallucinated "why"); lean toward it unless the person
  wants the latter specifically.
- Retrieval: `formatMemoryBlock` today returns ALL facts concatenated
  as one block, injected whenever `hasMemory` is true. At Phase 8's
  richer scope, this could get very large — needs a retrieval/summary
  strategy (e.g. only inject the categories relevant to the current
  task) before context budgets become a real problem on a 32k-context
  local model running batches of 20+ files.
- "Known bugs" and "previous decisions" risk growing unboundedly over a
  long project. Decide a retention/summarization strategy now, not
  after it's already a problem (mirrors a lesson from tonight's
  `replaceLastSection` fix — unbounded accumulation degrades the
  model's ability to act on any single item).

## Recommended first step in the new session

Do NOT start writing code immediately. First: re-read this doc, re-read
`planState.js` and `projectMemory.js` in full, then ask the person the
open design questions above before proposing a schema or pipeline
shape. Given the scope, expect this to span multiple sessions — resist
the urge to scaffold everything in one sitting; land and commit one
clear, tested, reviewed piece at a time, the way tonight's four items
were done.
