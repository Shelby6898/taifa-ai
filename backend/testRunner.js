const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { WORKSPACE_DIR } = require("./fileIndexer");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);
const MAX_OUTPUT_CHARS = 4000; // keep output readable in chat, avoid flooding the response
const TIMEOUT_MS = 30000; // guard against a hung test process on limited hardware

// Searches the workspace for a package.json declaring a "test" script,
// stopping at the first one found. Skips node_modules and other
// generated directories. Returns the absolute directory containing it,
// or null if none exists.
function findTestableProject(dir) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts && pkg.scripts.test) {
        return dir;
      }
    } catch (err) {
      // malformed package.json — skip, keep searching
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const found = findTestableProject(path.join(dir, entry.name));
    if (found) return found;
  }

  return null;
}

function truncateOutput(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_CHARS) + `\n\n[Output truncated — ${text.length - MAX_OUTPUT_CHARS} more characters not shown]`;
}

// Runs `npm test` in the first testable project found under the
// workspace. Uses execFile with a fixed command and argument list —
// never a shell string — so there is no injection surface regardless
// of what's in package.json or anywhere else in the workspace.
function runTests() {
  return new Promise((resolve) => {
    const projectDir = findTestableProject(WORKSPACE_DIR);

    if (!projectDir) {
      resolve({
        success: false,
        reason: "No package.json with a \"test\" script was found anywhere in the workspace."
      });
      return;
    }

    execFile(
      "npm",
      ["test"],
      { cwd: projectDir, timeout: TIMEOUT_MS },
      (error, stdout, stderr) => {
        resolve({
          success: true,
          projectDir: path.relative(WORKSPACE_DIR, projectDir) || ".",
          exitedWithError: error !== null,
          timedOut: error && error.killed === true,
          stdout: truncateOutput(stdout || ""),
          stderr: truncateOutput(stderr || "")
        });
      }
    );
  });
}

module.exports = { runTests, findTestableProject };
