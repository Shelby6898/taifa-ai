const fs = require("fs");
const path = require("path");

const WORKSPACES_ROOT = path.join(__dirname, "..", "workspace");

// sessionKey is already "<sanitized studentId>:<sanitized projectName>" —
// both halves were sanitized once in getSessionKey, so we trust them here
// rather than re-sanitizing.
function getWorkspaceDir(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");
  const dir = path.join(WORKSPACES_ROOT, studentId, projectName);

  // Lazy creation — matches the "fresh empty directory" decision.
  fs.mkdirSync(dir, { recursive: true });

  return dir;
}

module.exports = { getWorkspaceDir, WORKSPACES_ROOT };
