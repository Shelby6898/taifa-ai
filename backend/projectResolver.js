const { pool } = require("./db");

async function getOrCreateProjectId(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");

  if (!studentId || !projectName) {
    throw new Error(`Malformed sessionKey, expected "studentId:projectName": ${sessionKey}`);
  }

  await pool.query(
    "INSERT INTO students (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
    [studentId]
  );

  const { rows } = await pool.query(
    `INSERT INTO projects (student_id, name)
     VALUES ($1, $2)
     ON CONFLICT (student_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [studentId, projectName]
  );

  return rows[0].id;
}

module.exports = { getOrCreateProjectId };
