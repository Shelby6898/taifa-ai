const fs = require("fs");
const path = require("path");

const {
  WORKSPACES_ROOT
} = require("./workspaceResolver");

const {
  stopWatching
} = require("./fileIndexer");

const {
  clearMemory
} = require("./projectMemory");

const {
  clearHistory
} = require("./conversationHistory");

const {
  clearPlan,
  clearCampaign
} = require("./planState");

const {
  deleteBackupsForProject
} = require("./backupManager");
const { sanitizeKeyPart } = require("./sanitize");

const MEMORY_DIR = path.join(
  __dirname,
  "memory"
);

// Matches any per-session file by its shared suffix pattern
// (`<studentPart>__<projectPart>.json`), regardless of which subsystem's
// prefix it uses. This means a future subsystem that adds its own
// per-session file under memory/ gets cleaned up automatically on project
// deletion, without needing a hardcoded prefix list kept in sync by hand.
function deleteProjectMemoryIndexes(sessionKey) {
  const [rawStudentId, rawProjectName] = sessionKey.split(":");

  if (!rawStudentId || !rawProjectName) {
    throw new Error("Invalid session key");
  }

  const studentPart = sanitizeKeyPart(rawStudentId);
  const projectPart = sanitizeKeyPart(rawProjectName);

  if (!studentPart || !projectPart) {
    throw new Error("Invalid session key");
  }

  const deletedFiles = [];
  const suffix = `${studentPart}__${projectPart}.json`;

  if (!fs.existsSync(MEMORY_DIR)) {
    return deletedFiles;
  }

  for (const file of fs.readdirSync(MEMORY_DIR)) {
    if (!file.endsWith(suffix)) {
      continue;
    }

    const filePath = path.join(
      MEMORY_DIR,
      file
    );

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      fs.unlinkSync(filePath);
      deletedFiles.push(file);
    }
  }

  return deletedFiles;
}

async function deleteProject(sessionKey) {
  const [rawStudentId, rawProjectName] =
    sessionKey.split(":");

  if (!rawStudentId || !rawProjectName) {
    throw new Error("Invalid session key");
  }

  const studentId = sanitizeKeyPart(rawStudentId);
  const projectName = sanitizeKeyPart(rawProjectName);

  if (!studentId || !projectName) {
    throw new Error("Invalid session key");
  }

  // All project subsystems use the canonical session key.
  const canonicalSessionKey = `${studentId}:${projectName}`;

  /*
   * 1. Stop filesystem watcher first.
   */
  stopWatching(canonicalSessionKey);

  /*
   * 2. Delete project workspace.
   */
  const workspaceDir = path.join(
    WORKSPACES_ROOT,
    studentId,
    projectName
  );

  let workspaceDeleted = false;

  if (fs.existsSync(workspaceDir)) {
    fs.rmSync(workspaceDir, {
      recursive: true,
      force: true
    });

    workspaceDeleted = true;
  }

  /*
   * 3. Delete persistent project memory.
   */
  await clearMemory(canonicalSessionKey);

  /*
   * 3b. Delete conversation history and resolve any dangling
   * unresolved plans/campaigns. Conversation history has no
   * independent value once the project is gone, so it's deleted
   * outright. Already-resolved plans/campaigns keep their permanent
   * applied/rejected/completed/failed record per the earlier explicit
   * decision to preserve that history -- clearPlan/clearCampaign only
   * touch rows still resolution IS NULL, so this can't overwrite
   * anything already resolved.
   */
  await clearHistory(canonicalSessionKey);
  await clearPlan(canonicalSessionKey, "project_deleted");
  await clearCampaign(canonicalSessionKey, "project_deleted");

  /*
   * 4. Delete project indexes/history.
   */
  const deletedMemoryFiles =
    deleteProjectMemoryIndexes(sessionKey);

  const projectMemoryDeleted = deletedMemoryFiles.length > 0;

  /*
   * 5. Delete project-specific backups.
   */
  const backupResult =
    deleteBackupsForProject(sessionKey);

  /*
   * 6. Remove empty student workspace directory.
   */
  const studentWorkspaceDir = path.join(
    WORKSPACES_ROOT,
    studentId
  );

  let studentWorkspaceDeleted = false;

  if (fs.existsSync(studentWorkspaceDir)) {
    const remaining =
      fs.readdirSync(studentWorkspaceDir);

    if (remaining.length === 0) {
      fs.rmdirSync(studentWorkspaceDir);
      studentWorkspaceDeleted = true;
    }
  }

  return {
    success: true,

    projectName,

    workspaceDeleted,

    studentWorkspaceDeleted,

    projectMemoryDeleted,

    deletedMemoryFiles,

    deletedBackups:
      backupResult.deletedFiles,

    backupsDeleted:
      backupResult.deleted,

    message:
      `Project "${projectName}" deleted successfully`
  };
}

module.exports = {
  deleteProject
};
