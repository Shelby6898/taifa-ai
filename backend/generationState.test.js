const assert = require("assert");
const { test } = require("node:test");
const {
  startGenerating,
  isGenerating,
  getGenerating,
  stopGenerating
} = require("./generationState");

test("a session with nothing started is not generating", () => {
  assert.strictEqual(isGenerating("student1:projectA"), false);
  assert.strictEqual(getGenerating("student1:projectA"), null);
});

test("startGenerating marks a session as generating and getGenerating returns its info", () => {
  const sessionKey = "student2:projectB";
  startGenerating(sessionKey, "building a real estate platform");

  assert.strictEqual(isGenerating(sessionKey), true);
  const info = getGenerating(sessionKey);
  assert.strictEqual(info.description, "building a real estate platform");
  assert.strictEqual(info.type, "plan");
  assert.strictEqual(typeof info.startedAt, "number");

  stopGenerating(sessionKey);
});

test("type defaults to 'plan' but can be set to 'diffs' (used by /api/plan/approve and /api/plan/fix-file)", () => {
  const sessionKey = "student3:projectC";
  startGenerating(sessionKey, "Fixing backend/models/User.js", "diffs");

  const info = getGenerating(sessionKey);
  assert.strictEqual(info.type, "diffs");

  stopGenerating(sessionKey);
});

test("REGRESSION (tonight's bug): stopGenerating actually clears the flag, so a failed generation doesn't leave the session stuck", () => {
  const sessionKey = "student4:projectD";
  startGenerating(sessionKey, "something that will fail");
  assert.strictEqual(isGenerating(sessionKey), true);

  stopGenerating(sessionKey);
  assert.strictEqual(isGenerating(sessionKey), false);
  assert.strictEqual(getGenerating(sessionKey), null);
});

test("sessions are independent -- starting generation for one session never affects another", () => {
  const sessionA = "student5:projectE";
  const sessionB = "student6:projectF";

  startGenerating(sessionA, "session A's task");
  assert.strictEqual(isGenerating(sessionA), true);
  assert.strictEqual(isGenerating(sessionB), false);

  stopGenerating(sessionA);
});

test("stopGenerating on a session that was never started does not throw", () => {
  assert.doesNotThrow(() => stopGenerating("nobody:nothing"));
});
