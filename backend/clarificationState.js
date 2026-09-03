const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { sanitizeKeyPart } = require("./sanitize");

const sessions = new Map(); // sessionKey -> clarification object

// --- Disk persistence ---
//
// Clarification sessions (requirements Q&A, architecture-relevant-files
// confirmation, blueprint confirmation) previously lived only in memory,
// so a server restart silently wiped an in-flight session -- unlike
// planState.js, which already persists plans/campaigns. That gap meant
// free-text "approve"/"looks good" after a restart had nothing pending
// to guard against, and fell through to open-ended chat, which
// hallucinated a fake confirmation instead of erroring. Mirrors
// planState.js's persistence pattern exactly.

const CLARIFICATION_STATE_DIR = path.join(__dirname, "memory", "clarificationState");

function ensureClarificationStateDir() {
  if (!fs.existsSync(CLARIFICATION_STATE_DIR)) {
    fs.mkdirSync(CLARIFICATION_STATE_DIR, { recursive: true });
  }
}

function fileKeyFor(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");
  return `${sanitizeKeyPart(studentId)}__${sanitizeKeyPart(projectName)}`;
}

function sessionFilePath(sessionKey) {
  return path.join(CLARIFICATION_STATE_DIR, `session-${fileKeyFor(sessionKey)}.json`);
}

function persistSession(sessionKey) {
  const c = sessions.get(sessionKey);
  if (!c) return;
  ensureClarificationStateDir();
  fs.writeFileSync(
    sessionFilePath(sessionKey),
    JSON.stringify({ sessionKey, clarification: c }, null, 2)
  );
}

function removePersistedSession(sessionKey) {
  const fp = sessionFilePath(sessionKey);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
  }
}

function loadPersistedState() {
  if (!fs.existsSync(CLARIFICATION_STATE_DIR)) {
    return;
  }

  for (const file of fs.readdirSync(CLARIFICATION_STATE_DIR)) {
    const filePath = path.join(CLARIFICATION_STATE_DIR, file);

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (file.startsWith("session-") && parsed.sessionKey && parsed.clarification) {
        sessions.set(parsed.sessionKey, parsed.clarification);
      }
    } catch (err) {
      console.error(`[clarificationState] Failed to load ${file}:`, err.message);
    }
  }

  if (sessions.size > 0) {
    console.log(`[clarificationState] Restored ${sessions.size} pending clarification session(s) from disk`);
  }
}

function hasPendingClarification(sessionKey) {
  return sessions.has(sessionKey);
}

function getPendingClarification(sessionKey) {
  return sessions.get(sessionKey) || null;
}

function getPhase(sessionKey) {
  const c = sessions.get(sessionKey);
  if (!c) return null;
  return c.phase;
}

// questions: array of { text, tag } — tag identifies the category for
// building a structured Requirements Summary later without a second
// model call. Fixed, deterministic question set — no model involved
// in deciding what to ask, same reliability principle as campaign
// tracking in planState.js.
//
// memoryContext: optional string of established project facts (see
// projectMemory.js). Kept as its own field rather than concatenated
// into description, so the Requirements Summary can display it
// clearly instead of it bleeding awkwardly into the "Project:" line.
function startClarification(sessionKey, { description, questions, memoryContext }) {
  const id = crypto.randomBytes(8).toString("hex");

  const clarification = {
    id,
    description,
    questions, // [{ text, tag }]
    currentIndex: 0,
    answers: [], // [{ tag, question, answer, skipped }]
    phase: "questions",
    summaryText: null,
    enrichedDescription: null,
    relevantFiles: null,
    blueprint: null,
    memoryContext: memoryContext || null
  };

  sessions.set(sessionKey, clarification);
  persistSession(sessionKey);
  return clarification;
}

function recordAnswer(sessionKey, { answer, skipped }) {
  const c = sessions.get(sessionKey);
  if (!c) {
    return { success: false, reason: "No pending clarification session" };
  }

  const q = c.questions[c.currentIndex];
  c.answers.push({ tag: q.tag, question: q.text, answer, skipped });
  c.currentIndex += 1;
  persistSession(sessionKey);

  return { success: true, clarification: c };
}

function isComplete(sessionKey) {
  const c = sessions.get(sessionKey);
  if (!c) return false;
  return c.currentIndex >= c.questions.length;
}

function getCurrentQuestion(sessionKey) {
  const c = sessions.get(sessionKey);
  if (!c) return null;
  if (isComplete(sessionKey)) return null;
  return c.questions[c.currentIndex].text;
}

// Deterministic — builds a labeled summary directly from the tagged
// answers rather than asking the model to summarize, so this step
// can't drift or hallucinate a requirement that wasn't actually given.
// Only prints a line for a tag that was actually asked and answered —
// omitting untouched tags instead of printing "(not specified)" for
// every field the short question set (used when project memory
// already exists) never asks about.
function buildRequirementsSummary(sessionKey) {
  const c = sessions.get(sessionKey);
  if (!c) return "";

  const byTag = {};
  c.answers.forEach((a) => {
    byTag[a.tag] = a.skipped ? "(no preference given — best judgment)" : a.answer;
  });

  const labels = {
    users: "Users",
    features: "MVP features",
    platforms: "Platforms",
    tech: "Technology preferences",
    scale: "Expected scale",
    security: "Security requirements",
    success: "Success criteria"
  };

  const lines = [];
  if (c.memoryContext) {
    lines.push("Established project context (from memory):");
    lines.push(c.memoryContext.trim());
    lines.push("");
  }

  lines.push(`Project: ${c.description}`);
  lines.push("");

  Object.keys(labels).forEach((tag) => {
    if (byTag[tag] !== undefined) {
      lines.push(`${labels[tag]}: ${byTag[tag]}`);
    }
  });

  c.summaryText = lines.join("\n");
  return c.summaryText;
}

function setPhase(sessionKey, phase) {
  const c = sessions.get(sessionKey);
  if (!c) return;
  c.phase = phase;
  persistSession(sessionKey);
}

function setEnrichedDescription(sessionKey, desc) {
  const c = sessions.get(sessionKey);
  if (!c) return;
  c.enrichedDescription = desc;
  persistSession(sessionKey);
}

function getEnrichedDescription(sessionKey) {
  const c = sessions.get(sessionKey);
  if (!c) return null;
  return c.enrichedDescription;
}

function beginArchitectureConfirmation(sessionKey, { relevantFiles }) {
  const c = sessions.get(sessionKey);
  if (!c) {
    return { success: false, reason: "No pending clarification session" };
  }
  c.phase = "architecture";
  c.relevantFiles = relevantFiles;
  persistSession(sessionKey);
  return { success: true };
}

function getRelevantFiles(sessionKey) {
  const c = sessions.get(sessionKey);
  if (!c) return null;
  return c.relevantFiles;
}

function beginBlueprintConfirmation(sessionKey, { blueprint }) {
  const c = sessions.get(sessionKey);
  if (!c) {
    return { success: false, reason: "No pending clarification session" };
  }
  c.phase = "blueprint";
  c.blueprint = blueprint;
  persistSession(sessionKey);
  return { success: true };
}

function getBlueprint(sessionKey) {
  const c = sessions.get(sessionKey);
  if (!c) return null;
  return c.blueprint;
}

function clearClarification(sessionKey) {
  sessions.delete(sessionKey);
  removePersistedSession(sessionKey);
}

module.exports = {
  hasPendingClarification,
  getPendingClarification,
  getPhase,
  startClarification,
  recordAnswer,
  isComplete,
  getCurrentQuestion,
  buildRequirementsSummary,
  setPhase,
  setEnrichedDescription,
  getEnrichedDescription,
  beginArchitectureConfirmation,
  getRelevantFiles,
  beginBlueprintConfirmation,
  getBlueprint,
  clearClarification
};

loadPersistedState();
