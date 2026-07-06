const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { WORKSPACE_DIR } = require("./fileIndexer");

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache"]);

// Matches real npm package name rules: optional @scope/ prefix, lowercase
// alphanumerics plus hyphen/underscore/dot, cannot start with a dot or
// underscore, max 214 chars. Critically, this also rejects anything
// starting with "-", which blocks flag-injection attempts like
// "--registry=http://attacker.com" — execFile avoids shell injection,
// but does NOT stop a crafted string from being parsed as a CLI flag
// by npm itself if it were allowed through unchecked.
const VALID_PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9~][a-z0-9-._~]*$/;

function isValidPackageName(name) {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 214) return false;
  if (name.startsWith("-")) return false;
  return VALID_PACKAGE_NAME.test(name);
}

// Finds the nearest directory under WORKSPACE_DIR containing a
// package.json, so installs land in the right project rather than
// creating a stray node_modules at the workspace root.
function findNearestPackageJsonDir(dir) {
  if (!fs.existsSync(dir)) return null;
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) return dir;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const found = findNearestPackageJsonDir(path.join(dir, entry.name));
    if (found) return found;
  }
  return null;
}

function installPackage(packageName) {
  return new Promise((resolve) => {
    if (!isValidPackageName(packageName)) {
      resolve({
        success: false,
        reason: `"${packageName}" is not a valid npm package name — install rejected before running anything.`
      });
      return;
    }

    const projectDir = findNearestPackageJsonDir(WORKSPACE_DIR);
    if (!projectDir) {
      resolve({
        success: false,
        reason: "No package.json found anywhere in the workspace to install into."
      });
      return;
    }

    execFile(
      "npm",
      ["install", packageName],
      { cwd: projectDir, timeout: 60000 },
      (error, stdout, stderr) => {
        resolve({
          success: error === null,
          projectDir: path.relative(WORKSPACE_DIR, projectDir) || ".",
          stdout: stdout || "",
          stderr: stderr || "",
          errorMessage: error ? error.message : null
        });
      }
    );
  });
}

module.exports = { installPackage, isValidPackageName, findNearestPackageJsonDir };
