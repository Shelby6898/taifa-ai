const fs = require("fs");
const path = require("path");

const WORKSPACE_DIR = path.join(__dirname, "..", "workspace");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);

function buildTree(dir = WORKSPACE_DIR) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  return entries
    .filter((entry) => !SKIP_DIRS.has(entry.name))
    .map((entry) => {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(WORKSPACE_DIR, fullPath);

      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: relativePath,
          type: "folder",
          children: buildTree(fullPath)
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
