const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildPublishPreview, isIgnoredByDefault } = require("./githubPublishPreview");

function withProject(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-test-"));
  try {
    for (const rel of files) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, "x\n");
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("isIgnoredByDefault matches env files and logs but not examples", () => {
  assert.equal(isIgnoredByDefault(".env"), true);
  assert.equal(isIgnoredByDefault("src/.env.production"), true);
  assert.equal(isIgnoredByDefault("debug.log"), true);
  assert.equal(isIgnoredByDefault(".env.example"), false);
  assert.equal(isIgnoredByDefault("src/app.js"), false);
});

test("success lists real files and skips ignored folders and env files", () => {
  withProject(["src/app.js", "package.json", ".env", "node_modules/x/i.js", "dist/out.js"], (dir) => {
    const result = buildPublishPreview({ projectDir: dir, projectName: "Demo App" });
    assert.equal(result.ok, true);
    assert.equal(result.repoName, "demo-app");
    assert.equal(result.visibility, "private");
    assert.equal(result.fileCount, 2);
    assert.deepEqual([...result.filesPreview].sort(), ["package.json", "src/app.js"]);
    assert.equal(result.moreFiles, 0);
  });
});

test(".env.example is included in the file list", () => {
  withProject(["src/app.js", ".env.example"], (dir) => {
    const result = buildPublishPreview({ projectDir: dir, projectName: "demo" });
    assert.equal(result.ok, true);
    assert.ok(result.filesPreview.includes(".env.example"));
  });
});

test("a nested .pem file blocks the preview and is named", () => {
  withProject(["src/app.js", "keys/server.pem"], (dir) => {
    const result = buildPublishPreview({ projectDir: dir, projectName: "demo" });
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes("keys/server.pem"));
  });
});

test("a project with its own .git is refused", () => {
  withProject(["src/app.js", ".git/HEAD"], (dir) => {
    const result = buildPublishPreview({ projectDir: dir, projectName: "demo" });
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes("own git repository"));
  });
});

test("a missing project folder is refused", () => {
  const result = buildPublishPreview({ projectDir: "/nonexistent/xyz", projectName: "demo" });
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes("does not exist"));
});

test("an invalid project name is refused", () => {
  withProject(["src/app.js"], (dir) => {
    const result = buildPublishPreview({ projectDir: dir, projectName: "!!!" });
    assert.equal(result.ok, false);
  });
});

test("a project with only ignored files has nothing to publish", () => {
  withProject([".env", "debug.log", "node_modules/x/i.js"], (dir) => {
    const result = buildPublishPreview({ projectDir: dir, projectName: "demo" });
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes("no files"));
  });
});

test("more than 20 files are truncated with a remainder count", () => {
  const names = Array.from({ length: 25 }, (_, i) => "src/f" + i + ".js");
  withProject(names, (dir) => {
    const result = buildPublishPreview({ projectDir: dir, projectName: "demo" });
    assert.equal(result.ok, true);
    assert.equal(result.fileCount, 25);
    assert.equal(result.filesPreview.length, 20);
    assert.equal(result.moreFiles, 5);
  });
});
