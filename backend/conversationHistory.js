const { pool } = require("./db");
const { getOrCreateProjectId } = require("./projectResolver");

async function loadHistory(sessionKey) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT role, content, action, data FROM conversation_messages WHERE project_id = $1 ORDER BY created_at, id",
    [projectId]
  );
  return rows.map((r) =>
    r.role === "user"
      ? { role: r.role, content: r.content }
      : { role: r.role, action: r.action, data: r.data, content: r.content }
  );
}

async function appendUserTurn(sessionKey, content) {
  const projectId = await getOrCreateProjectId(sessionKey);
  await pool.query(
    "INSERT INTO conversation_messages (project_id, role, content) VALUES ($1, 'user', $2)",
    [projectId, content]
  );
}

async function appendAssistantTurn(sessionKey, { action, data, content }) {
  const projectId = await getOrCreateProjectId(sessionKey);
  await pool.query(
    "INSERT INTO conversation_messages (project_id, role, action, data, content) VALUES ($1, 'assistant', $2, $3, $4)",
    [projectId, action, JSON.stringify(data), content]
  );
}

// Deletes all conversation history for a project. Called on project
// deletion -- conversation history has no independent value once the
// project itself is gone, unlike plans/campaigns which keep a
// permanent applied/rejected record even after the project is deleted.
async function clearHistory(sessionKey) {
  const projectId = await getOrCreateProjectId(sessionKey);
  await pool.query("DELETE FROM conversation_messages WHERE project_id = $1", [projectId]);
}

module.exports = { loadHistory, appendUserTurn, appendAssistantTurn, clearHistory };
