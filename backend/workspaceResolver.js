const fs = require("fs");
const path = require("path");
const { sanitizeKeyPart } = require("./sanitize");

const WORKSPACES_ROOT = path.join(__dirname, "..", "workspace");

// sessionKey is already "<sanitized studentId>:<sanitized projectName>" —
// both halves were sanitized once in getSessionKey, so we trust them here
// rather than re-sanitizing.
function getWorkspaceDir(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");

  return path.join(
    WORKSPACES_ROOT,
    studentId,
    projectName
  );
}

function ensureWorkspace(sessionKey) {
  const dir = getWorkspaceDir(sessionKey);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Lists the project names (sanitized directory names) that exist for a
// given student, by reading their subdirectories under workspace/<studentId>/.
// Used by the /api/projects endpoint to populate the frontend's project
// dropdown. studentId here is the RAW value (e.g. req.userId) — this
// function does its own sanitizing, matching how getWorkspaceDir's
// directories were actually named on disk.
function listProjectsForStudent(studentId) {
  const studentDir = path.join(WORKSPACES_ROOT, sanitizeKeyPart(studentId));

  if (!fs.existsSync(studentDir)) {
    return [];
  }

  return fs.readdirSync(studentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

module.exports = {
  getWorkspaceDir,
  ensureWorkspace,
  listProjectsForStudent,
  WORKSPACES_ROOT
};
