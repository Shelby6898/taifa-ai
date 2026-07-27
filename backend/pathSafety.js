const fs = require("fs");
const path = require("path");
const { getWorkspaceDir } = require("./workspaceResolver");

function isPathSafe(sessionKey, userPath) {
  if (!userPath || typeof userPath !== "string") {
    return { safe: false, reason: "No path provided" };
  }

  if (path.isAbsolute(userPath)) {
    return { safe: false, reason: "Absolute paths are not allowed" };
  }

  const workspaceDir = getWorkspaceDir(sessionKey);
  const workspaceReal = fs.realpathSync(workspaceDir);
  const resolvedPath = path.resolve(workspaceDir, userPath);

  const isInsideWorkspaceString =
    resolvedPath === workspaceDir ||
    resolvedPath.startsWith(workspaceDir + path.sep);

  if (!isInsideWorkspaceString) {
    return { safe: false, reason: "Path escapes the workspace directory" };
  }

  // Now check the REAL path, following any symlinks, to catch the case
  // where a symlinked directory inside the workspace secretly points outside.
  // realpathSync requires the target to exist, so we resolve the
  // containing directory's real path (which must exist) and rejoin
  // the filename, rather than requiring the file itself to exist.
  const parentDir = path.dirname(resolvedPath);
  const fileName = path.basename(resolvedPath);

  let parentReal;
  try {
    parentReal = fs.realpathSync(parentDir);
  } catch (err) {
    // Parent directory doesn't exist yet (e.g. writing into a new
    // subfolder). That's allowed for new files/folders — there's no
    // symlink risk in a path that doesn't exist on disk at all.
    return { safe: true, resolvedPath };
  }

  const realFinalPath = path.join(parentReal, fileName);
  const isInsideWorkspaceReal =
    realFinalPath === workspaceReal ||
    realFinalPath.startsWith(workspaceReal + path.sep);

  if (!isInsideWorkspaceReal) {
    return { safe: false, reason: "Path resolves outside workspace via symlink" };
  }

  return { safe: true, resolvedPath };
}

module.exports = { isPathSafe };
