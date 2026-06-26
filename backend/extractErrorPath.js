const path = require("path");

// Matches Node.js stack trace frames like:
//   at functionName (/path/to/file.js:12:5)
//   at /path/to/file.js:12:5
//   at Object.<anonymous> (/path/to/file.js:12:5)
const STACK_FRAME_PATTERN = /\(?((?:\/|[a-zA-Z]:\\)[^\s():]+\.(?:js|jsx|ts|tsx)):\d+:\d+\)?/g;

function extractCandidatePaths(errorText) {
  if (!errorText || typeof errorText !== "string") {
    return [];
  }

  const matches = [...errorText.matchAll(STACK_FRAME_PATTERN)];
  return matches.map((m) => m[1]);
}

function findWorkspaceRelativePath(errorText, workspaceDir) {
  const candidates = extractCandidatePaths(errorText);

  for (const candidatePath of candidates) {
    // Skip anything obviously not in the user's own project —
    // node_modules and Node's internal modules are never what
    // we want to "fix".
    if (candidatePath.includes("node_modules")) continue;
    if (candidatePath.startsWith("node:")) continue;

    const normalizedCandidate = path.normalize(candidatePath);
    const normalizedWorkspace = path.normalize(workspaceDir);

    if (normalizedCandidate.startsWith(normalizedWorkspace)) {
      return path.relative(normalizedWorkspace, normalizedCandidate);
    }
  }

  return null;
}

module.exports = { extractCandidatePaths, findWorkspaceRelativePath };
