const fs = require("fs");
const path = require("path");
const { WORKSPACE_DIR } = require("./fileIndexer");

// Walks upward from the given file's directory, within WORKSPACE_DIR
// only, looking for the nearest package.json to determine the real
// module system Node will enforce at runtime for that location —
// "module" (ES import/export required, require() undefined) or
// "commonjs" (require/module.exports, the Node default when no
// package.json or no "type" field is present).
function getModuleSystemForPath(absPath) {
  let dir = path.dirname(absPath);

  for (let i = 0; i < 6; i++) {
    if (!dir.startsWith(WORKSPACE_DIR)) break;

    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        return pkg.type === "module" ? "module" : "commonjs";
      } catch (err) {
        return "commonjs";
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return "commonjs";
}

// Deterministically checks whether generated code contains a module
// system mismatch that would guarantee a runtime crash — e.g. a
// top-level require() call in a directory where package.json declares
// "type": "module" (require is not defined in that context), or ES
// import/export syntax in a plain CommonJS context. This does not rely
// on the model correctly inferring or following instructions about
// module systems — it is a real deterministic check against the
// generated text.
function detectModuleSystemMismatch(code, requiredSystem) {
  const usesRequire = /(^|\n)\s*(const|let|var)\s+[\w{}\s,]+=\s*require\(/.test(code);
  const usesEsImportExport = /(^|\n)\s*(import\s|export\s)/.test(code);

  // A require() call in an ES-module location is broken regardless of
  // whether import/export ALSO appears elsewhere in the same file —
  // mixed usage is just as guaranteed to crash as require() alone.
  if (requiredSystem === "module" && usesRequire) {
    return {
      mismatch: true,
      reason: "This location requires ES module syntax (package.json has \"type\": \"module\"), but the generated code uses require(), which is not defined in that context and would throw at runtime."
    };
  }

  if (requiredSystem === "commonjs" && usesEsImportExport) {
    return {
      mismatch: true,
      reason: "This location uses CommonJS (no \"type\": \"module\" in the nearest package.json), but the generated code uses import/export syntax, which Node will reject as a SyntaxError in that context."
    };
  }

  return { mismatch: false, reason: null };
}

module.exports = { getModuleSystemForPath, detectModuleSystemMismatch };
