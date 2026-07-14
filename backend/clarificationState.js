const crypto = require("crypto");

let pendingClarification = null;

function hasPendingClarification() {
  return pendingClarification !== null;
}

function getPendingClarification() {
  return pendingClarification;
}

// questions: array of plain question strings, generated once up front
// so the question set stays fixed even if the model would answer
// differently on a second call — same reliability principle as
// campaign tracking in planState.js: don't ask the model to
// regenerate state that must stay consistent across turns.
function startClarification({ description, questions }) {
  const id = crypto.randomBytes(8).toString("hex");

  pendingClarification = {
    id,
    description,
    questions, // string[]
    currentIndex: 0,
    answers: [] // [{ question, answer, skipped }]
  };

  return pendingClarification;
}

function recordAnswer({ answer, skipped }) {
  if (!pendingClarification) {
    return { success: false, reason: "No pending clarification session" };
  }

  const question = pendingClarification.questions[pendingClarification.currentIndex];
  pendingClarification.answers.push({ question, answer, skipped });
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
  return pendingClarification.questions[pendingClarification.currentIndex];
}

// Builds a single enriched description combining the original request
// with every question/answer pair, clearly marking any that were
// skipped so the plan-generation prompt can instruct the model to
// state its assumption explicitly for those.
function buildEnrichedDescription() {
  if (!pendingClarification) return "";

  const qaLines = pendingClarification.answers.map((a) => {
    if (a.skipped) {
      return `- ${a.question}\n  (No preference given — use your best judgment, and explicitly state the assumption you made in the relevant file's description.)`;
    }
    return `- ${a.question}\n  ${a.answer}`;
  });

  return `${pendingClarification.description}\n\nAdditional context gathered from the user:\n${qaLines.join("\n")}`;
}

function clearClarification() {
  pendingClarification = null;
}

module.exports = {
  hasPendingClarification,
  getPendingClarification,
  startClarification,
  recordAnswer,
  isComplete,
  getCurrentQuestion,
  buildEnrichedDescription,
  clearClarification
};
