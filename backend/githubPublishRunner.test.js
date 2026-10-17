const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { GITIGNORE_CONTENT } = require("./githubPublisher");
const { publishNewProject, mergeGitignore } = require("./githubPublishRunner");

const ok = (stdout = "") => ({ success: true, stdout, stderr: "" });
const bad = (stderr) => ({ success: false, stdout: "", stderr });

function makeRun(handler) {
  const calls = [];
  const run = async (cmd, args, opts) => {
    calls.push([cmd, ...args]);
    const custom = handler ? handler(cmd, args, opts) : undefined;
    if (custom) return custom;
    if (cmd === "git" && args[0] === "init") {
      fs.mkdirSync(path.join(opts.cwd, ".git"), { recursive: true });
      return ok();
    }
    if (cmd === "git" && args[0] === "rev-parse") return ok(opts.cwd + "\n");
    if (cmd === "git" && args[0] === "diff") return ok("src/app.js\0.gitignore\0");
    if (cmd === "git" && args[0] === "remote") return bad("no such remote");
    if (cmd === "gh") return ok("https://github.com/Shelby6898/demo-app\n");
    return ok();
  };
  return { run, calls };
}

async function withProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-test-"));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const names = (calls) => calls.map((c) => c[0] + " " + c[1]);
const gitDirOf = (dir) => path.join(dir, ".git");

test("mergeGitignore on empty input yields the full rule set", () => {
  assert.equal(mergeGitignore(""), GITIGNORE_CONTENT);
});

test("mergeGitignore keeps custom rules and does not duplicate", () => {
  const merged = mergeGitignore("custom/\nnode_modules/\n");
  assert.ok(merged.includes("custom/"));
  assert.ok(merged.includes(".env"));
  assert.equal(merged.split("\n").filter((l) => l === "node_modules/").length, 1);
});

test("mergeGitignore is idempotent", () => {
  const once = mergeGitignore("custom/\n");
  assert.equal(mergeGitignore(once), once);
});

test("mergeGitignore handles a missing trailing newline", () => {
  assert.ok(mergeGitignore("custom/").startsWith("custom/\n"));
});

test("success path runs the steps in order and publishes private", async () => {
  await withProject(async (dir) => {
    const { run, calls } = makeRun();
    const result = await publishNewProject({ projectDir: dir, projectName: "Demo App", run });
    assert.equal(result.success, true);
    assert.equal(result.repoName, "demo-app");
    assert.equal(result.url, "https://github.com/Shelby6898/demo-app");
    assert.deepEqual(names(calls), [
      "git init", "git rev-parse", "git add", "git diff", "git commit", "gh repo"
    ]);
    assert.ok(calls[0].includes("main"));
    assert.ok(calls[5].includes("--private"));
    assert.ok(calls[5].includes("demo-app"));
    assert.ok(fs.readFileSync(path.join(dir, ".gitignore"), "utf8").includes(".env"));
  });
});

test("invalid project name is refused before any command runs", async () => {
  await withProject(async (dir) => {
    const { run, calls } = makeRun();
    const result = await publishNewProject({ projectDir: dir, projectName: "!!!", run });
    assert.equal(result.success, false);
    assert.equal(result.stage, "validate");
    assert.equal(calls.length, 0);
  });
});

test("missing project folder is refused", async () => {
  const { run, calls } = makeRun();
  const result = await publishNewProject({ projectDir: "/nonexistent/xyz", projectName: "demo", run });
  assert.equal(result.success, false);
  assert.equal(result.stage, "validate");
  assert.equal(calls.length, 0);
});

test("already published project is refused and its .git is untouched", async () => {
  await withProject(async (dir) => {
    fs.mkdirSync(gitDirOf(dir));
    const { run, calls } = makeRun((cmd, args) =>
      cmd === "git" && args[0] === "remote" ? ok("https://github.com/Shelby6898/x.git\n") : undefined
    );
    const result = await publishNewProject({ projectDir: dir, projectName: "demo", run });
    assert.equal(result.success, false);
    assert.equal(result.stage, "classify");
    assert.ok(result.reason.includes("https://github.com/Shelby6898/x.git"));
    assert.deepEqual(calls, [["git", "remote", "get-url", "origin"]]);
    assert.ok(fs.existsSync(gitDirOf(dir)));
    assert.ok(!fs.existsSync(path.join(dir, ".gitignore")));
  });
});

test("own git repo with no origin is refused and left untouched", async () => {
  await withProject(async (dir) => {
    fs.mkdirSync(gitDirOf(dir));
    const { run, calls } = makeRun();
    const result = await publishNewProject({ projectDir: dir, projectName: "demo", run });
    assert.equal(result.success, false);
    assert.equal(result.stage, "classify");
    assert.equal(calls.length, 1);
    assert.ok(fs.existsSync(gitDirOf(dir)));
  });
});

test("secret files stop the publish before commit and roll back .git", async () => {
  await withProject(async (dir) => {
    const { run, calls } = makeRun((cmd, args) =>
      cmd === "git" && args[0] === "diff" ? ok(".env\0src/app.js\0") : undefined
    );
    const result = await publishNewProject({ projectDir: dir, projectName: "demo", run });
    assert.equal(result.success, false);
    assert.equal(result.stage, "secrets");
    assert.ok(result.reason.includes(".env"));
    assert.ok(!names(calls).includes("git commit"));
    assert.ok(!names(calls).includes("gh repo"));
    assert.ok(!fs.existsSync(gitDirOf(dir)));
  });
});

test("a git root that is not the project folder stops before staging", async () => {
  await withProject(async (dir) => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "pub-other-"));
    try {
      const { run, calls } = makeRun((cmd, args) =>
        cmd === "git" && args[0] === "rev-parse" ? ok(other + "\n") : undefined
      );
      const result = await publishNewProject({ projectDir: dir, projectName: "demo", run });
      assert.equal(result.success, false);
      assert.equal(result.stage, "verify");
      assert.ok(!names(calls).includes("git add"));
      assert.ok(!fs.existsSync(gitDirOf(dir)));
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});

test("nothing to commit is refused and rolled back", async () => {
  await withProject(async (dir) => {
    const { run } = makeRun((cmd, args) =>
      cmd === "git" && args[0] === "diff" ? ok("") : undefined
    );
    const result = await publishNewProject({ projectDir: dir, projectName: "demo", run });
    assert.equal(result.success, false);
    assert.equal(result.stage, "stage");
    assert.ok(!fs.existsSync(gitDirOf(dir)));
  });
});

test("commit failure rolls back and never calls gh", async () => {
  await withProject(async (dir) => {
    const { run, calls } = makeRun((cmd, args) =>
      cmd === "git" && args[0] === "commit" ? bad("identity unknown") : undefined
    );
    const result = await publishNewProject({ projectDir: dir, projectName: "demo", run });
    assert.equal(result.success, false);
    assert.equal(result.stage, "commit");
    assert.ok(!names(calls).includes("gh repo"));
    assert.ok(!fs.existsSync(gitDirOf(dir)));
  });
});

test("gh failure rolls back and tells the user to check GitHub", async () => {
  await withProject(async (dir) => {
    const { run } = makeRun((cmd) => (cmd === "gh" ? bad("name already exists") : undefined));
    const result = await publishNewProject({ projectDir: dir, projectName: "demo", run });
    assert.equal(result.success, false);
    assert.equal(result.stage, "github");
    assert.ok(result.reason.includes("name already exists"));
    assert.ok(result.reason.includes("delete or rename"));
    assert.ok(!fs.existsSync(gitDirOf(dir)));
  });
});

test("an existing .gitignore keeps its own rules on a successful publish", async () => {
  await withProject(async (dir) => {
    fs.writeFileSync(path.join(dir, ".gitignore"), "custom/\n");
    const { run } = makeRun();
    const result = await publishNewProject({ projectDir: dir, projectName: "demo", run });
    assert.equal(result.success, true);
    const content = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    assert.ok(content.includes("custom/"));
    assert.ok(content.includes(".env"));
  });
});

test("url is only the GitHub link even when gh prints extra lines", async () => {
  await withProject(async (dir) => {
    const { run } = makeRun((cmd) =>
      cmd === "gh"
        ? ok("https://github.com/Shelby6898/demo-app\nbranch 'main' set up to track 'origin/main'.\n")
        : undefined
    );
    const result = await publishNewProject({ projectDir: dir, projectName: "demo-app", run });
    assert.equal(result.success, true);
    assert.equal(result.url, "https://github.com/Shelby6898/demo-app");
  });
});

test("url is found when gh prints it on stderr", async () => {
  await withProject(async (dir) => {
    const { run } = makeRun((cmd) =>
      cmd === "gh"
        ? { success: true, stdout: "", stderr: "https://github.com/Shelby6898/demo-app\n" }
        : undefined
    );
    const result = await publishNewProject({ projectDir: dir, projectName: "demo-app", run });
    assert.equal(result.url, "https://github.com/Shelby6898/demo-app");
  });
});

test("url is null, not junk, when gh prints no link", async () => {
  await withProject(async (dir) => {
    const { run } = makeRun((cmd) => (cmd === "gh" ? ok("done\n") : undefined));
    const result = await publishNewProject({ projectDir: dir, projectName: "demo-app", run });
    assert.equal(result.success, true);
    assert.equal(result.url, null);
  });
});
