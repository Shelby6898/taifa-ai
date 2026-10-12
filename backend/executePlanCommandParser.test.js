const assert = require("assert");
const { test } = require("node:test");
const { parseExecutePlanCommand } = require("./executePlanCommandParser");

test("not an execute plan command when message is empty or non-string", () => {
  assert.deepStrictEqual(parseExecutePlanCommand(""), { isExecutePlanCommand: false });
  assert.deepStrictEqual(parseExecutePlanCommand(null), { isExecutePlanCommand: false });
  assert.deepStrictEqual(parseExecutePlanCommand(undefined), { isExecutePlanCommand: false });
});

test("not an execute plan command when trigger phrase is absent", () => {
  const result = parseExecutePlanCommand("plan: build something");
  assert.strictEqual(result.isExecutePlanCommand, false);
});

test("REGRESSION (tonight's bug): a bare trigger with no description must be malformed, not silently falling through to chat", () => {
  const result = parseExecutePlanCommand("execute plan:\na.js: do a thing\nb.js: do another thing");
  assert.strictEqual(result.isExecutePlanCommand, true);
  assert.strictEqual(result.malformed, true);
  assert.match(result.reason, /No description provided/);
});

test("REGRESSION (tonight's bug): the first file written on the trigger line must be malformed, not silently swallowed into the description and dropped", () => {
  const result = parseExecutePlanCommand("execute plan: a.js: do a thing\nb.js: do another thing");
  assert.strictEqual(result.isExecutePlanCommand, true);
  assert.strictEqual(result.malformed, true);
  assert.match(result.reason, /looks like a file entry/);
  assert.match(result.reason, /a\.js: do a thing/);
});

test("a real description followed by files parses correctly, with no files lost", () => {
  const result = parseExecutePlanCommand("execute plan: Build auth forms\na.js: form one\nb.js: form two");
  assert.strictEqual(result.isExecutePlanCommand, true);
  assert.strictEqual(result.malformed, false);
  assert.strictEqual(result.description, "Build auth forms");
  assert.deepStrictEqual(result.files, [
    { path: "a.js", description: "form one" },
    { path: "b.js", description: "form two" }
  ]);
});

test("a description that itself contains a colon is not mistaken for a file line", () => {
  const cases = [
    "execute plan: Fix bug: email not validating\na.js: x",
    "execute plan: Improve the login.js flow\na.js: x",
    "execute plan: Add CSV export, see report.csv for format\na.js: x"
  ];
  for (const message of cases) {
    const result = parseExecutePlanCommand(message);
    assert.strictEqual(result.malformed, false, `expected not malformed for: ${message}`);
  }
});

test("malformed with no files listed when a real description has no file lines after it", () => {
  const result = parseExecutePlanCommand("execute plan: Build auth forms");
  assert.strictEqual(result.isExecutePlanCommand, true);
  assert.strictEqual(result.malformed, true);
  assert.match(result.reason, /No files listed/);
});

test("a file line with no colon is reported as malformed, naming the bad line", () => {
  const result = parseExecutePlanCommand("execute plan: Build auth forms\nthis has no colon");
  assert.strictEqual(result.malformed, true);
  assert.match(result.reason, /could not be parsed/);
  assert.match(result.reason, /this has no colon/);
});

test("a description containing its own colon still splits file lines on the FIRST colon only", () => {
  const result = parseExecutePlanCommand("execute plan: Build the thing\na.js: handles login: verifies credentials");
  assert.strictEqual(result.malformed, false);
  assert.deepStrictEqual(result.files, [
    { path: "a.js", description: "handles login: verifies credentials" }
  ]);
});
