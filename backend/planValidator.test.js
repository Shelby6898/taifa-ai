const assert = require("assert");
const { test } = require("node:test");
const { checkMissingRequiredScope } = require("./planValidator");

const webOnlyFile = [{ path: "frontend/App.jsx", description: "web app" }];

test("REGRESSION (tonight's bug): real-estate-platform's actual deferral phrasing must not be flagged", () => {
  const text = "Web only for the first release. Android and iOS come later.";
  assert.deepStrictEqual(checkMissingRequiredScope(webOnlyFile, text), []);
});

test("REGRESSION (tonight's bug): agrivalue-ai's actual deferral phrasing must not be flagged", () => {
  const text = "Android and iOS apps can be added in a later phase once the web platform is stable.";
  assert.deepStrictEqual(checkMissingRequiredScope(webOnlyFile, text), []);
});

test("a genuine same-release Android requirement IS flagged when no Android file exists", () => {
  const text = "The app must support Android from day one, with push notifications.";
  const result = checkMissingRequiredScope(webOnlyFile, text);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].type, "missing_required_scope");
});

test("a genuine same-release Android requirement IS flagged when phrased as part of v1 scope", () => {
  const text = "We need an Android app and a React web frontend both in v1.";
  const result = checkMissingRequiredScope(webOnlyFile, text);
  assert.strictEqual(result.length, 1);
});

test("no mention of Android at all never triggers the rule", () => {
  const text = "No mobile apps planned at all.";
  assert.deepStrictEqual(checkMissingRequiredScope(webOnlyFile, text), []);
});

test("a genuine Android requirement is NOT flagged once an Android file actually exists in the plan", () => {
  const text = "The app must support Android from day one, with push notifications.";
  const files = [{ path: "android/MainActivity.kt", description: "Android entry point" }];
  assert.deepStrictEqual(checkMissingRequiredScope(files, text), []);
});

test("empty or missing requirements text never throws and never flags anything", () => {
  assert.deepStrictEqual(checkMissingRequiredScope(webOnlyFile, ""), []);
  assert.deepStrictEqual(checkMissingRequiredScope(webOnlyFile, null), []);
  assert.deepStrictEqual(checkMissingRequiredScope(webOnlyFile, undefined), []);
});
