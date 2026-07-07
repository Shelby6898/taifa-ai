const { Linter } = require("eslint");

const linter = new Linter();

// A broad set of globals covering both the Node/CommonJS backend code
// and the browser/ES-module frontend code in this workspace, so
// legitimate identifiers (require, module, document, fetch, etc.)
// don't get flagged as undefined — that's not what this check is for.
// Its job is catching typos and genuinely unreferenced identifiers,
// not policing which environment a file "should" run in.
const COMMON_GLOBALS = {
  require: "readonly",
  module: "readonly",
  exports: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  global: "readonly",
  document: "readonly",
  window: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  localStorage: "readonly",
  navigator: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly"
};

const FLAT_CONFIG = {
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    globals: COMMON_GLOBALS,
    parserOptions: {
      ecmaFeatures: { jsx: true }
    }
  },
  rules: {
    "no-unused-vars": "warn",
    "no-undef": "warn",
    "no-unreachable": "error",
    "no-dupe-keys": "error",
    "no-redeclare": "warn",
    "no-const-assign": "error",
    "no-dupe-args": "error"
  }
};

// Lints a piece of generated code in-memory, no disk I/O — same
// architecture as syntaxChecker.js and importChecker.js. Returns a
// list of issues, each with severity, message, and line/column, or
// an empty list if clean. Never throws; a lint failure to even run
// (e.g. on genuinely unparseable input) is reported as a single
// issue rather than propagating an exception into the caller.
function checkLint(code) {
  try {
    const messages = linter.verify(code, FLAT_CONFIG);
    return messages.map((m) => ({
      severity: m.severity === 2 ? "error" : "warning",
      rule: m.ruleId,
      message: m.message,
      line: m.line,
      column: m.column
    }));
  } catch (err) {
    return [{ severity: "error", rule: null, message: "Linter failed to run: " + err.message, line: null, column: null }];
  }
}

module.exports = { checkLint };
