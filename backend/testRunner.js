const fs = require("fs");
const path = require("path");
const { execFile, execFileSync } = require("child_process");
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
//
// This is the whole-project "run tests" command, distinct from the
// per-file mechanical verification functions below.
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

// Given a source file path, find its sibling test file using the
// convention used throughout this codebase: X.js -> X.test.js in the
// same directory. Returns null if no such file exists.
function findTestFile(resolvedPath) {
  if (resolvedPath.endsWith(".test.js")) return null;
  const ext = path.extname(resolvedPath);
  const base = resolvedPath.slice(0, -ext.length);
  const candidate = `${base}.test.js`;
  return fs.existsSync(candidate) ? candidate : null;
}

// Mechanically verifies a proposed file change by actually writing it
// to disk temporarily, running the real test suite against it, and
// restoring the original content afterward -- regardless of outcome.
//
// This replaces asking the model to judge its own output (self-review)
// with an independent, deterministic check: either the existing tests
// pass against the new code, or they don't. No interpretation involved.
function runTestsAgainstProposal(resolvedPath, proposedContent) {
  const testFilePath = findTestFile(resolvedPath);

  if (!testFilePath) {
    return { hasTests: false, skippedReason: "No test file exists for this source file." };
  }

  let originalContent = null;
  let fileExisted = false;
  try {
    originalContent = fs.readFileSync(resolvedPath, "utf-8");
    fileExisted = true;
  } catch (err) {
    fileExisted = false;
  }

  try {
    fs.writeFileSync(resolvedPath, proposedContent, "utf-8");

    let output = "";
    let passed = true;
    try {
      output = execFileSync("node", ["--test", testFilePath], {
        encoding: "utf-8",
        timeout: 30000
      });
    } catch (err) {
      passed = false;
      output = (err.stdout || "") + (err.stderr || "");
    }

    return { hasTests: true, passed, testFilePath, output };
  } finally {
    if (fileExisted) {
      fs.writeFileSync(resolvedPath, originalContent, "utf-8");
    } else {
      try { fs.unlinkSync(resolvedPath); } catch (e) { /* nothing to clean up */ }
    }
  }
}

// For newly generated TEST files specifically: write the proposed test
// content to disk at its real path and actually execute it with
// node --test, then restore whatever was there before (or remove it if
// the test file didn't already exist). Unlike runTestsAgainstProposal,
// there's no "sibling file" lookup here -- the resolvedPath IS the test
// file being generated, and we're checking whether it actually runs and
// passes against the real, already-existing source file.
function runGeneratedTestFile(resolvedTestPath) {
  let originalContent = null;
  let fileExisted = false;
  try {
    originalContent = fs.readFileSync(resolvedTestPath, "utf-8");
    fileExisted = true;
  } catch (err) {
    fileExisted = false;
  }

  try {
    let output = "";
    let passed = true;
    try {
      output = execFileSync("node", ["--test", resolvedTestPath], {
        encoding: "utf-8",
        timeout: 30000
      });
    } catch (err) {
      passed = false;
      output = (err.stdout || "") + (err.stderr || "");
    }

    return { hasTests: true, passed, output };
  } finally {
    if (fileExisted) {
      fs.writeFileSync(resolvedTestPath, originalContent, "utf-8");
    } else {
      try { fs.unlinkSync(resolvedTestPath); } catch (e) { /* nothing to clean up */ }
    }
  }
}

module.exports = { runTests, findTestableProject, runTestsAgainstProposal, runGeneratedTestFile };
