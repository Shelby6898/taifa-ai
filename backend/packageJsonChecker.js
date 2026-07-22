const fs = require("fs");
const path = require("path");
const https = require("https");
const { builtinModules } = require("module");

const BUILTIN_SET = new Set(builtinModules);

// Given a require()/import specifier, returns the top-level package
// name it refers to, or null if it's a relative path or Node builtin.
// Handles scoped packages (@scope/pkg/sub -> @scope/pkg) and subpath
// imports (firebase-admin/firestore -> firebase-admin).
function normalizePackageName(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (BUILTIN_SET.has(specifier) || specifier.startsWith("node:")) return null;

  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return parts[0];
}

// Extracts the set of external package names a piece of JS/JSX source
// actually imports, via require() calls and ES module import
// statements. Regex-based rather than a full AST parse, matching the
// approach already used elsewhere in this codebase (regressionChecker).
function extractRequiredPackages(content) {
  const packages = new Set();

  const requirePattern = /require\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  const importPattern = /(?:^|\s)import\s+(?:[\w*{}\s,]+\s+from\s+)?['"`]([^'"`]+)['"`]/g;

  let match;
  while ((match = requirePattern.exec(content)) !== null) {
    const name = normalizePackageName(match[1]);
    if (name) packages.add(name);
  }
  while ((match = importPattern.exec(content)) !== null) {
    const name = normalizePackageName(match[1]);
    if (name) packages.add(name);
  }

  return packages;
}

// Walks upward from a file's directory looking for the nearest
// package.json (same approach as testRunner.js's project detection).
function findNearestPackageJson(startDir) {
  let dir = startDir;
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        return { pkgPath, pkg: JSON.parse(fs.readFileSync(pkgPath, "utf-8")) };
      } catch (err) {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Checks whether a proposed file's require()/import statements
// reference any package that isn't declared in the nearest
// package.json's dependencies or devDependencies. This is exactly the
// class of bug found repeatedly in manual testing: generated code
// assuming a package (bcrypt, various Firebase variants, etc.) that
// was never actually added to package.json, only discovered later when
// npm install/require failed at runtime.
//
// Returns an array of undeclared package names (empty if none, or if
// no package.json could be found -- in which case we can't meaningfully
// check anything and stay silent rather than guess).
function checkUndeclaredDependencies(resolvedFilePath, content) {
  const nearest = findNearestPackageJson(path.dirname(resolvedFilePath));
  if (!nearest) return [];

  const declared = new Set([
    ...Object.keys(nearest.pkg.dependencies || {}),
    ...Object.keys(nearest.pkg.devDependencies || {})
  ]);

  const required = extractRequiredPackages(content);
  const undeclared = [];
  for (const pkg of required) {
    if (!declared.has(pkg)) undeclared.push(pkg);
  }

  return undeclared;
}

// Queries the real npm registry to check whether a specific version
// actually exists for a package. Used specifically when package.json
// itself is being edited, to catch a hallucinated version number
// (e.g. firebase-admin@^9.20.0, which was never published at any
// point in that package's real history) before npm install ever runs
// and fails on it.
function fetchPublishedVersions(packageName) {
  return new Promise((resolve, reject) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
    const req = https.get(url, { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Registry returned status ${res.statusCode} for ${packageName}`));
      }
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(Object.keys(parsed.versions || {}));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Registry request for ${packageName} timed out`));
    });
  });
}

// Strips a semver range prefix (^, ~, >=, etc.) down to the bare
// version number for an exact-match check against the registry's
// published versions list. This is intentionally simple -- it checks
// "does this literal version exist", not "does some version satisfy
// this range" -- because the actual bug we're guarding against is a
// fully invented version string, not a legitimately narrow range.
function stripRangePrefix(versionRange) {
  return versionRange.replace(/^[\^~>=<]+/, "").trim();
}

// Checks every dependency declared in a proposed package.json against
// the real npm registry, flagging any whose exact specified version
// was never actually published. Requires network access; if the
// registry can't be reached for a package, that package is skipped
// (reported separately) rather than treated as a failure, since a
// network hiccup shouldn't block an otherwise-valid change.
async function checkPackageVersionsExist(packageJsonContent) {
  let pkg;
  try {
    pkg = JSON.parse(packageJsonContent);
  } catch (err) {
    return { invalidVersions: [], unreachable: [], parseError: err.message };
  }

  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const invalidVersions = [];
  const unreachable = [];

  for (const [name, range] of Object.entries(allDeps)) {
    const exactVersion = stripRangePrefix(range);
    // Skip non-exact-version specifiers (git URLs, "latest", workspace
    // links, etc.) -- this check only targets literal version numbers.
    if (!/^\d+\.\d+\.\d+/.test(exactVersion)) continue;

    try {
      const publishedVersions = await fetchPublishedVersions(name);
      if (!publishedVersions.includes(exactVersion)) {
        invalidVersions.push({ name, specifiedVersion: range, exactVersion });
      }
    } catch (err) {
      unreachable.push({ name, reason: err.message });
    }
  }

  return { invalidVersions, unreachable };
}

module.exports = {
  extractRequiredPackages,
  checkUndeclaredDependencies,
  checkPackageVersionsExist,
  normalizePackageName
};
