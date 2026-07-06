const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { WORKSPACE_DIR } = require("./fileIndexer");

const RISKY_PATH_SEGMENTS = ["node_modules", "dist", "build", ".cache", "vendor", "__pycache__"];

function isGitRepo() {
  return fs.existsSync(path.join(WORKSPACE_DIR, ".git"));
}

function runGit(args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: WORKSPACE_DIR, timeout: 15000 }, (error, stdout, stderr) => {
      resolve({
        success: error === null,
        stdout: stdout || "",
        stderr: stderr || "",
        errorMessage: error ? error.message : null
      });
    });
  });
}

async function getStatus() {
  if (!isGitRepo()) {
    return { success: false, reason: "The workspace is not a git repository." };
  }
  return runGit(["status", "--porcelain"]);
}

async function getDiff() {
  if (!isGitRepo()) {
    return { success: false, reason: "The workspace is not a git repository." };
  }

  // git diff HEAD fails on a brand-new repo with no commits yet — fall
  // back to a plain working-tree diff in that case rather than erroring.
  const withHead = await runGit(["diff", "HEAD"]);
  if (withHead.success) return withHead;

  return runGit(["diff"]);
}

// Scans git status output for path segments that look like generated
// or vendored content (node_modules, build output, caches, etc.).
// This check runs regardless of whether a .gitignore exists — relying
// solely on .gitignore being correctly configured is not safe enough,
// since a truncated diff preview can hide the true scope of a commit
// from human review even when the change looks small at a glance.
// Returns an array of distinct risky path segments found, or [] if none.
function detectRiskyPaths(statusOutput) {
  const lines = statusOutput.split("\n").filter((l) => l.trim().length > 0);
  const found = new Set();

  for (const line of lines) {
    const filePath = line.slice(3).trim();
    for (const segment of RISKY_PATH_SEGMENTS) {
      if (filePath.includes("/" + segment + "/") || filePath.startsWith(segment + "/")) {
        found.add(segment);
      }
    }
  }

  return [...found];
}

async function commitChanges(message) {
  if (!isGitRepo()) {
    return { success: false, reason: "The workspace is not a git repository." };
  }

  const addResult = await runGit(["add", "-A"]);
  if (!addResult.success) {
    return { success: false, reason: "git add failed: " + addResult.errorMessage };
  }

  const commitResult = await runGit(["commit", "-m", message]);
  if (!commitResult.success) {
    return { success: false, reason: "git commit failed: " + (commitResult.stderr || commitResult.errorMessage) };
  }

  return { success: true, stdout: commitResult.stdout };
}

module.exports = { isGitRepo, getStatus, getDiff, commitChanges, detectRiskyPaths };
