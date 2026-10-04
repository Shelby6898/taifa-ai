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


// Renames a deleted project's row instead of deleting it, so its
// permanently-resolved plan/campaign history (see projectDeletion.js) stays
// intact and queryable, while freeing up the original (student_id, name)
// pair so a NEW project can be created under the same name without
// getOrCreateProjectId's ON CONFLICT silently resolving to the old,
// deleted project's id and inheriting its history. Called only from
// deleteProject, after any plan/campaign resolution that still needs to
// look the project up by its original name.
async function renameDeletedProject(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");

  if (!studentId || !projectName) {
    throw new Error(`Malformed sessionKey, expected "studentId:projectName": ${sessionKey}`);
  }

  const deletedName = `__deleted__${projectName}__${new Date().toISOString()}`;

  const { rowCount } = await pool.query(
    `UPDATE projects SET name = $1 WHERE student_id = $2 AND name = $3`,
    [deletedName, studentId, projectName]
  );

  return { renamed: rowCount > 0, deletedName };
}

module.exports = { getOrCreateProjectId, renameDeletedProject };
