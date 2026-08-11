
const fs = require("fs");
const path = require("path");

const { ensureWatching, stopWatching } = require("./fileIndexer");
const { deleteProject } = require("./projectDeletion");
const { getWorkspaceDir } = require("./workspaceResolver");

const rawSession = "DELETE.TEST/WATCHER.STUDENT:Watcher Test Project!";
const canonicalSession = "delete-test-watcher-student:watcher-test-project";

const workspaceDir = getWorkspaceDir(canonicalSession);
const testFile = path.join(workspaceDir, "watcher-test.js");

console.log("=== 1. Preparing disposable project ===");

fs.mkdirSync(workspaceDir, { recursive: true });
fs.writeFileSync(testFile, "console.log('watcher deletion test');\n");

console.log("Raw session:      ", rawSession);
console.log("Canonical session:", canonicalSession);

console.log("\n=== 2. Starting canonical watcher ===");

ensureWatching(canonicalSession);

console.log("\n=== 3. Deleting using RAW key ===");

const result = deleteProject(rawSession);

console.log(JSON.stringify(result, null, 2));

console.log("\n=== 4. Re-requesting canonical watcher ===");

ensureWatching(canonicalSession);

console.log("\n=== 5. Cleaning up ===");

stopWatching(canonicalSession);

console.log("Workspace exists:", fs.existsSync(workspaceDir));

if (fs.existsSync(workspaceDir)) {
  fs.rmSync(workspaceDir, { recursive: true, force: true });
}

console.log("\n✅ WATCHER DELETION TEST COMPLETED");
