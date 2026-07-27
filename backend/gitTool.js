const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getWorkspaceDir } = require("./workspaceResolver");

const RISKY_PATH_SEGMENTS = ["node_modules", "dist", "build", ".cache", "vendor", "__pycache__"];

function isGitRepo(sessionKey) {
  return fs.existsSync(path.join(getWorkspaceDir(sessionKey), ".git"));
}

function runGit(sessionKey, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd: getWorkspaceDir(sessionKey), timeout: 15000 }, (error, stdout, stderr) => {
      resolve({
        success: error === null,
        stdout: stdout || "",
        stderr: stderr || "",
        errorMessage: error ? error.message : null
      });
    });
  });
}

async function getStatus(sessionKey) {
  if (!isGitRepo(sessionKey)) {
    return { success: false, reason: "The workspace is not a git repository." };
  }
  return runGit(sessionKey, ["status", "--porcelain"]);
}

async function getDiff(sessionKey) {
  if (!isGitRepo(sessionKey)) {
    return { success: false, reason: "The workspace is not a git repository." };
  }

  // git diff HEAD fails on a brand-new repo with no commits yet — fall
  // back to a plain working-tree diff in that case rather than erroring.
  const withHead = await runGit(sessionKey, ["diff", "HEAD"]);
  if (withHead.success) return withHead;

  return runGit(sessionKey, ["diff"]);
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

async function commitChanges(sessionKey, message) {
  if (!isGitRepo(sessionKey)) {
    return { success: false, reason: "The workspace is not a git repository." };
  }

  const addResult = await runGit(sessionKey, ["add", "-A"]);
  if (!addResult.success) {
    return { success: false, reason: "git add failed: " + addResult.errorMessage };
  }

  const commitResult = await runGit(sessionKey, ["commit", "-m", message]);
  if (!commitResult.success) {
    return { success: false, reason: "git commit failed: " + (commitResult.stderr || commitResult.errorMessage) };
  }

  return { success: true, stdout: commitResult.stdout };
}

module.exports = { isGitRepo, getStatus, getDiff, commitChanges, detectRiskyPaths };
