const fs = require("fs");
const path = require("path");

function historyPathFor(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");
  return path.join(__dirname, "memory", `conversationHistory-${studentId}__${projectName}.json`);
}

function loadHistory(sessionKey) {
  const historyPath = historyPathFor(sessionKey);
  if (!fs.existsSync(historyPath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(historyPath, "utf-8"));
  } catch (err) {
    console.error("[conversationHistory] Failed to parse history file, starting fresh:", err.message);
    return [];
  }
}

function saveHistory(sessionKey, turns) {
  const historyPath = historyPathFor(sessionKey);
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  fs.writeFileSync(historyPath, JSON.stringify(turns, null, 2));
}

function appendUserTurn(sessionKey, content) {
  const turns = loadHistory(sessionKey);
  turns.push({ role: "user", content });
  saveHistory(sessionKey, turns);
  return turns;
}

// content here is a plain-text summary for the MODEL's own context window,
// not for display — the frontend uses `action` + `data` (the raw response
// payload) with its own shared formatter to render what the student sees.
// Keeping these two jobs separate avoids the model-facing summary and the
// human-facing sentence ever needing to match wording.
function appendAssistantTurn(sessionKey, { action, data, content }) {
  const turns = loadHistory(sessionKey);
  turns.push({ role: "assistant", action, data, content });
  saveHistory(sessionKey, turns);
  return turns;
}

module.exports = { loadHistory, appendUserTurn, appendAssistantTurn };
