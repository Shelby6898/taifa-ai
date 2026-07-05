const parser = require("@babel/parser");

// Parses the given source with plugins covering JSX, modern JS syntax
// (class properties, optional chaining, etc.), and JSX-in-.js files
// (since many of your files use JSX without a .jsx extension is
// uncommon here, but this stays permissive rather than guessing off
// file extension, so both .js and .jsx get the same treatment).
const PARSE_OPTIONS = {
  sourceType: "unambiguous",
  plugins: [
    "jsx",
    "classProperties",
    "optionalChaining",
    "nullishCoalescingOperator",
    "objectRestSpread"
  ],
  errorRecovery: false
};

// Checks whether a piece of generated code is syntactically valid.
// Returns { valid: true } or { valid: false, message, line, column } —
// deliberately not throwing, since this is meant to sit in a diff
// review flow where a syntax problem is a warning to show, not a
// crash to propagate.
function checkSyntax(code) {
  try {
    parser.parse(code, PARSE_OPTIONS);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      message: err.message,
      line: err.loc ? err.loc.line : null,
      column: err.loc ? err.loc.column : null
    };
  }
}

module.exports = { checkSyntax };
