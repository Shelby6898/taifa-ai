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
  deleteBackupsForProject
} = require("./backupManager");
const { sanitizeKeyPart } = require("./sanitize");

const MEMORY_DIR = path.join(
  __dirname,
  "memory"
);

const MEMORY_PREFIXES = [
  "conversationHistory-",
  "fileIndex-",
  "importGraph-",
  "functionIndex-",
  "componentGraph-",
  "dbSchema-"
];

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

  if (!fs.existsSync(MEMORY_DIR)) {
    return deletedFiles;
  }

  for (const file of fs.readdirSync(MEMORY_DIR)) {
    const matches = MEMORY_PREFIXES.some(
      (prefix) =>
        file === `${prefix}${studentPart}__${projectPart}.json`
    );

    if (!matches) {
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

function deleteProject(sessionKey) {
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
  clearMemory(canonicalSessionKey);

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
