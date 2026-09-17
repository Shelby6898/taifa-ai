const { pool } = require("./db");
const { getOrCreateProjectId } = require("./projectResolver");

async function addFact(sessionKey, fact) {
  const projectId = await getOrCreateProjectId(sessionKey);
  await pool.query(
    "INSERT INTO project_memory_facts (project_id, fact) VALUES ($1, $2)",
    [projectId, fact]
  );
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM project_memory_facts WHERE project_id = $1",
    [projectId]
  );
  return { added: true, totalFacts: rows[0].count };
}

async function getAllFacts(sessionKey) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT fact FROM project_memory_facts WHERE project_id = $1 ORDER BY created_at",
    [projectId]
  );
  return rows.map((r) => r.fact);
}

async function formatMemoryBlock(sessionKey) {
  const facts = await getAllFacts(sessionKey);
  if (facts.length === 0) {
    return "";
  }
  return `Project memory (persistent facts about this project):\n${facts.map((f) => `- ${f}`).join("\n")}\n\n`;
}

async function clearMemory(sessionKey) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const result = await pool.query(
    "DELETE FROM project_memory_facts WHERE project_id = $1",
    [projectId]
  );
  return result.rowCount > 0;
}

module.exports = { addFact, getAllFacts, formatMemoryBlock, clearMemory };
