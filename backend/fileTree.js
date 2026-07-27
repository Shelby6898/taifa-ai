const fs = require("fs");
const path = require("path");
const { getWorkspaceDir } = require("./workspaceResolver");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);

function buildTree(sessionKey, dir = null) {
  const workspaceDir = getWorkspaceDir(sessionKey);
  const currentDir = dir || workspaceDir;

  if (!fs.existsSync(currentDir)) return [];

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  return entries
    .filter((entry) => !SKIP_DIRS.has(entry.name))
    .map((entry) => {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(workspaceDir, fullPath);

      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: relativePath,
          type: "folder",
          children: buildTree(sessionKey, fullPath)
        };
      }

      return {
        name: entry.name,
        path: relativePath,
        type: "file"
      };
    })
    .sort((a, b) => {
      // Folders first, then alphabetical within each group
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

module.exports = { buildTree };
