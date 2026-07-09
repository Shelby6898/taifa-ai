const fs = require("fs");
const path = require("path");
const { WORKSPACE_DIR } = require("./fileIndexer");

const NODE_BUILTINS = new Set([
  "fs", "path", "http", "https", "crypto", "os", "url", "util",
  "events", "stream", "child_process", "assert", "buffer", "querystring", "test"
]);

const RESOLVE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const REQUIRE_PATTERN = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const IMPORT_PATTERN = /import\s+(?:[\w*\s{},]+from\s+)?['"]([^'"]+)['"]/g;

function extractSpecifiers(content) {
  const specifiers = new Set();
  let match;

  REQUIRE_PATTERN.lastIndex = 0;
  while ((match = REQUIRE_PATTERN.exec(content)) !== null) {
    specifiers.add(match[1]);
  }
  IMPORT_PATTERN.lastIndex = 0;
  while ((match = IMPORT_PATTERN.exec(content)) !== null) {
    specifiers.add(match[1]);
  }

  return [...specifiers];
}

function findPackageJson(startDir) {
  let dir = startDir;
  for (let i = 0; i < 5; i++) {
    if (!dir.startsWith(WORKSPACE_DIR)) break;
    const candidate = path.join(dir, "package.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadDeclaredDependencies(targetAbsDir) {
  const pkgPath = findPackageJson(targetAbsDir);
  if (!pkgPath) return null;

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    return new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {})
    ]);
  } catch (err) {
    return null;
  }
}

// Checks that every require/import in generated code resolves to a real
// file (relative imports) or a declared dependency (external packages,
// only if a package.json is findable — otherwise externals are marked
// "unverified" rather than falsely flagged as missing).
//
// targetAbsPath is where this generated content is intended to live —
// used to resolve relative imports correctly even for a brand-new file
// that doesn't exist on disk yet.
//
// siblingAbsPaths (optional): absolute paths of OTHER files being
// proposed in the same batch (e.g. a multi-file plan not yet applied).
// Without this, a new file importing another new file from the same
// batch would always be falsely flagged "missing", since neither file
// exists on disk until the whole batch is actually applied. These
// paths are treated as if they already exist, purely for resolution
// purposes, alongside real on-disk files.
function checkImports(content, targetAbsPath, siblingAbsPaths = []) {
  const specifiers = extractSpecifiers(content);
  const targetDir = path.dirname(targetAbsPath);
  const declaredDeps = loadDeclaredDependencies(targetDir);
  const siblingSet = new Set(siblingAbsPaths);

  const results = specifiers.map((specifier) => {
    if (specifier.startsWith(".")) {
      const baseAbsPath = path.resolve(targetDir, specifier);
      const candidates = [
        baseAbsPath,
        ...RESOLVE_EXTENSIONS.map((ext) => baseAbsPath + ext),
        ...RESOLVE_EXTENSIONS.map((ext) => path.join(baseAbsPath, "index" + ext))
      ];
      const existsOnDisk = candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
      const existsAsSibling = candidates.some((c) => siblingSet.has(c));
      const exists = existsOnDisk || existsAsSibling;
      return { specifier, type: "relative", status: exists ? "ok" : "missing" };
    }

    const normalizedSpecifier = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
    if (NODE_BUILTINS.has(normalizedSpecifier)) {
      return { specifier, type: "builtin", status: "ok" };
    }

    if (declaredDeps === null) {
      return { specifier, type: "external", status: "unverified" };
    }

    const pkgName = specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];

    return {
      specifier,
      type: "external",
      status: declaredDeps.has(pkgName) ? "ok" : "not_in_package_json"
    };
  });

  const hasMissing = results.some((r) => r.status === "missing" || r.status === "not_in_package_json");

  return { hasMissing, results };
}

module.exports = { checkImports };
