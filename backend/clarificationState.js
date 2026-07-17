const crypto = require("crypto");

let pendingClarification = null;

function hasPendingClarification() {
  return pendingClarification !== null;
}

function getPendingClarification() {
  return pendingClarification;
}

function getPhase() {
  if (!pendingClarification) return null;
  return pendingClarification.phase;
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
function startClarification({ description, questions, memoryContext }) {
  const id = crypto.randomBytes(8).toString("hex");

  pendingClarification = {
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

  return pendingClarification;
}

function recordAnswer({ answer, skipped }) {
  if (!pendingClarification) {
    return { success: false, reason: "No pending clarification session" };
  }

  const q = pendingClarification.questions[pendingClarification.currentIndex];
  pendingClarification.answers.push({ tag: q.tag, question: q.text, answer, skipped });
  pendingClarification.currentIndex += 1;

  return { success: true, clarification: pendingClarification };
}

function isComplete() {
  if (!pendingClarification) return false;
  return pendingClarification.currentIndex >= pendingClarification.questions.length;
}

function getCurrentQuestion() {
  if (!pendingClarification) return null;
  if (isComplete()) return null;
  return pendingClarification.questions[pendingClarification.currentIndex].text;
}

// Deterministic — builds a labeled summary directly from the tagged
// answers rather than asking the model to summarize, so this step
// can't drift or hallucinate a requirement that wasn't actually given.
// Only prints a line for a tag that was actually asked and answered —
// omitting untouched tags instead of printing "(not specified)" for
// every field the short question set (used when project memory
// already exists) never asks about.
function buildRequirementsSummary() {
  if (!pendingClarification) return "";

  const byTag = {};
  pendingClarification.answers.forEach((a) => {
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

  if (pendingClarification.memoryContext) {
    lines.push("Established project context (from memory):");
    lines.push(pendingClarification.memoryContext.trim());
    lines.push("");
  }

  lines.push(`Project: ${pendingClarification.description}`);
  lines.push("");

  Object.keys(labels).forEach((tag) => {
    if (byTag[tag] !== undefined) {
      lines.push(`${labels[tag]}: ${byTag[tag]}`);
    }
  });

  pendingClarification.summaryText = lines.join("\n");
  return pendingClarification.summaryText;
}

function setPhase(phase) {
  if (!pendingClarification) return;
  pendingClarification.phase = phase;
}

function setEnrichedDescription(desc) {
  if (!pendingClarification) return;
  pendingClarification.enrichedDescription = desc;
}

function getEnrichedDescription() {
  if (!pendingClarification) return null;
  return pendingClarification.enrichedDescription;
}

function beginArchitectureConfirmation({ relevantFiles }) {
  if (!pendingClarification) {
    return { success: false, reason: "No pending clarification session" };
  }
  pendingClarification.phase = "architecture";
  pendingClarification.relevantFiles = relevantFiles;
  return { success: true };
}

function getRelevantFiles() {
  if (!pendingClarification) return null;
  return pendingClarification.relevantFiles;
}

function beginBlueprintConfirmation({ blueprint }) {
  if (!pendingClarification) {
    return { success: false, reason: "No pending clarification session" };
  }
  pendingClarification.phase = "blueprint";
  pendingClarification.blueprint = blueprint;
  return { success: true };
}

function getBlueprint() {
  if (!pendingClarification) return null;
  return pendingClarification.blueprint;
}

function clearClarification() {
  pendingClarification = null;
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
