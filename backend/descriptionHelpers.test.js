const assert = require("assert");
const { test } = require("node:test");
const { replaceLastSection, cleanDescription } = require("./descriptionHelpers");

test("replaceLastSection appends a new section when the marker has never appeared before", () => {
  const result = replaceLastSection("Base description.", "Correction:\n", "first fix");
  assert.strictEqual(result, "Base description.\n\nCorrection:\nfirst fix");
});

test("REGRESSION (tonight's bug): a second correction REPLACES the first instead of stacking on top of it", () => {
  let desc = "Base description.";
  desc = replaceLastSection(desc, "Correction:\n", "first fix");
  desc = replaceLastSection(desc, "Correction:\n", "second, different fix");

  assert.strictEqual(desc, "Base description.\n\nCorrection:\nsecond, different fix");
  assert.doesNotMatch(desc, /first fix/);
});

test("REGRESSION (tonight's bug): repeated corrections never accumulate, no matter how many rounds", () => {
  let desc = "Base description.";
  for (let i = 1; i <= 8; i++) {
    desc = replaceLastSection(desc, "Correction:\n", `fix number ${i}`);
  }
  assert.strictEqual(desc, "Base description.\n\nCorrection:\nfix number 8");
  const occurrences = (desc.match(/Correction:/g) || []).length;
  assert.strictEqual(occurrences, 1);
});

test("two different markers (e.g. Revision vs Correction) are tracked independently", () => {
  let desc = "Base description.";
  desc = replaceLastSection(desc, "Revision from the user:\n", "revised the summary");
  desc = replaceLastSection(desc, "Correction from the user about the architecture:\n", "use MySQL instead");

  assert.match(desc, /Revision from the user:\nrevised the summary/);
  assert.match(desc, /Correction from the user about the architecture:\nuse MySQL instead/);
});

test("cleanDescription strips an echoed Path/Description label pair", () => {
  const result = cleanDescription("Path: backend/models/User.js\nDescription: Defines the User model.");
  assert.strictEqual(result, "Defines the User model.");
});

test("cleanDescription leaves an ordinary description untouched", () => {
  const result = cleanDescription("Defines the User model.");
  assert.strictEqual(result, "Defines the User model.");
});

test("cleanDescription passes through non-string input unchanged", () => {
  assert.strictEqual(cleanDescription(null), null);
  assert.strictEqual(cleanDescription(undefined), undefined);
});
