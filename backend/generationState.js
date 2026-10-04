// Tracks whether a plan is currently being generated for a session, so a
// browser refresh mid-generation (which can take minutes on a local model)
// has something to restore instead of landing on an empty chat with no
// pending state at all -- clarification is already cleared by the time
// generation starts, and nothing else is written until generation
// completes, so without this there's a real window where /api/session/current
// has nothing to report. In-memory only: if the backend itself restarts,
// the in-flight generation is gone anyway, so there's nothing meaningful
// to persist past that.
const generating = new Map(); // sessionKey -> { description, startedAt }

function startGenerating(sessionKey, description, type = "plan") {
  generating.set(sessionKey, { type, description, startedAt: Date.now() });
}

function isGenerating(sessionKey) {
  return generating.has(sessionKey);
}

function getGenerating(sessionKey) {
  return generating.get(sessionKey) || null;
}

function stopGenerating(sessionKey) {
  generating.delete(sessionKey);
}

module.exports = {
  startGenerating,
  isGenerating,
  getGenerating,
  stopGenerating
};
