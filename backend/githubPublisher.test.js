const test = require("node:test");
const assert = require("node:assert/strict");
const {
  GITIGNORE_CONTENT,
  toRepoName,
  validateRepoName,
  classifyPublishState,
  detectSecretFiles,
  detectSecretContent
} = require("./githubPublisher");

test("toRepoName lowercases and replaces spaces", () => {
  assert.equal(toRepoName("Real Estate App"), "real-estate-app");
});

test("toRepoName strips leading and trailing junk", () => {
  assert.equal(toRepoName("--My_App!!"), "my_app");
  assert.equal(toRepoName(".hidden"), "hidden");
});

test("toRepoName returns empty string for null or empty input", () => {
  assert.equal(toRepoName(null), "");
  assert.equal(toRepoName(undefined), "");
  assert.equal(toRepoName(""), "");
});

test("toRepoName caps length at 100", () => {
  assert.equal(toRepoName("a".repeat(150)).length, 100);
});

test("toRepoName neutralizes shell metacharacters", () => {
  const name = toRepoName("foo; rm -rf ~");
  assert.match(name, /^[a-z0-9][a-z0-9._-]*$/);
  assert.equal(validateRepoName(name).valid, true);
});

test("validateRepoName accepts good names", () => {
  assert.equal(validateRepoName("real-estate-app").valid, true);
  assert.equal(validateRepoName("app_2.0").valid, true);
});

test("validateRepoName rejects bad names", () => {
  for (const bad of ["", "-abc", "Abc", "a b", "foo;rm", undefined, null, 42]) {
    assert.equal(validateRepoName(bad).valid, false, `should reject ${String(bad)}`);
  }
});

test("validateRepoName enforces the 100 character boundary", () => {
  assert.equal(validateRepoName("a".repeat(100)).valid, true);
  assert.equal(validateRepoName("a".repeat(101)).valid, false);
});

test("validateRepoName rejects a .git suffix", () => {
  assert.equal(validateRepoName("app.git").valid, false);
});

test("classifyPublishState covers all three states", () => {
  assert.equal(classifyPublishState({ hasOwnGit: false, hasOrigin: false }), "needs_init");
  assert.equal(classifyPublishState({ hasOwnGit: true, hasOrigin: false }), "needs_remote");
  assert.equal(classifyPublishState({ hasOwnGit: true, hasOrigin: true }), "already_published");
});

test("detectSecretFiles flags secrets at any depth", () => {
  const flagged = detectSecretFiles([
    ".env",
    "src/.env.production",
    "keys/server.pem",
    "id_rsa",
    "config/api.key"
  ]);
  assert.deepEqual(flagged, [
    ".env",
    "src/.env.production",
    "keys/server.pem",
    "id_rsa",
    "config/api.key"
  ]);
});

test("detectSecretFiles leaves safe files alone", () => {
  const flagged = detectSecretFiles([
    "backend/.env.example",
    ".env.sample",
    "src/app.js",
    "src/environment.js",
    "src/monkey.js"
  ]);
  assert.deepEqual(flagged, []);
});

test("GITIGNORE_CONTENT ignores env files but re-includes the example", () => {
  assert.ok(GITIGNORE_CONTENT.includes("node_modules/"));
  assert.ok(GITIGNORE_CONTENT.includes("\n.env\n"));
  assert.ok(GITIGNORE_CONTENT.indexOf("!.env.example") > GITIGNORE_CONTENT.indexOf(".env.*"));
  assert.ok(GITIGNORE_CONTENT.endsWith("\n"));
});


test("detectSecretContent identifies common provider credentials", () => {
  assert.ok(detectSecretContent("AWS_KEY=AKIA1234567890ABCDEF").includes("aws_access_key"));
  assert.ok(detectSecretContent("token=ghp_abcdefghijklmnopqrstuvwxyz123456").includes("github_token"));
  assert.ok(detectSecretContent("key=AIza" + "A".repeat(35)).includes("google_api_key"));
  assert.ok(detectSecretContent("token=xoxb-1234567890-abcdefghij").includes("slack_token"));
  assert.ok(detectSecretContent("key=sk_live_12345678901234567890").includes("stripe_key"));
});

test("detectSecretContent identifies private keys and JWT-like tokens", () => {
  assert.ok(detectSecretContent("-----BEGIN RSA PRIVATE KEY-----").includes("private_key"));
  assert.ok(detectSecretContent(
    "token=eyJabcdefgh.eyJabcdefgh.signature123"
  ).includes("jwt"));
});

test("detectSecretContent identifies credential assignments", () => {
  assert.ok(detectSecretContent('API_KEY="a-real-looking-key-value-123"').includes("credential_assignment"));
  assert.ok(detectSecretContent("password: SuperSecretPassword123").includes("credential_assignment"));
});

test("detectSecretContent ignores common placeholders and environment references", () => {
  const safe = [
    "API_KEY=your_api_key_here",
    "SECRET_KEY=CHANGE_ME",
    "TOKEN=example_token",
    "PASSWORD=your_password",
    "API_KEY=${API_KEY}",
    "API_KEY=process.env.API_KEY",
    "API_KEY=<your-key>"
  ].join("\n");

  assert.deepEqual(detectSecretContent(safe), []);
});

test("detectSecretContent returns categories, never the matched credential", () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456";
  const result = detectSecretContent(`GITHUB_TOKEN=${secret}`);

  assert.ok(result.includes("github_token"));
  assert.ok(!result.includes(secret));
  assert.ok(result.every((item) => typeof item === "string"));
});

test("detectSecretContent handles empty and non-string input", () => {
  assert.deepEqual(detectSecretContent(""), []);
  assert.deepEqual(detectSecretContent(null), []);
  assert.deepEqual(detectSecretContent(undefined), []);
});
