// Runs the publish flow for a brand-new generated project. The command
// runner and fs are injected so tests can fake git/gh. Version 1 only
// creates and pushes NEW repos; anything with its own .git is refused.

const nodeFs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const {
  GITIGNORE_CONTENT,
  toRepoName,
  validateRepoName,
  classifyPublishState,
  detectSecretFiles
} = require("./githubPublisher");

const FIRST_COMMIT_MESSAGE = "Initial commit from Taifa AI";
const GIT_TIMEOUT_MS = 30000;
const GH_TIMEOUT_MS = 120000;

function defaultRun(cmd, args, options) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: options.cwd, timeout: options.timeout }, (error, stdout, stderr) => {
      resolve({ success: error === null, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

// Adds any missing ignore rules to an existing .gitignore instead of
// overwriting the project's own rules.
function mergeGitignore(existing) {
  const have = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = GITIGNORE_CONTENT.split("\n").filter((l) => l && !have.has(l));
  if (missing.length === 0) return existing;
  const base = existing && !existing.endsWith("\n") ? existing + "\n" : existing;
  return base + missing.join("\n") + "\n";
}

async function publishNewProject({ projectDir, projectName, run = defaultRun, fs = nodeFs }) {
  const repoName = toRepoName(projectName);
  const nameCheck = validateRepoName(repoName);
  if (!nameCheck.valid) {
    return { success: false, stage: "validate", reason: nameCheck.reason };
  }
  if (!fs.existsSync(projectDir)) {
    return { success: false, stage: "validate", reason: "Project folder does not exist." };
  }

  const git = (args) => run("git", args, { cwd: projectDir, timeout: GIT_TIMEOUT_MS });
  const gitDir = path.join(projectDir, ".git");

  const hasOwnGit = fs.existsSync(gitDir);
  let remoteUrl = "";
  if (hasOwnGit) {
    const remote = await git(["remote", "get-url", "origin"]);
    if (remote.success) remoteUrl = remote.stdout.trim();
  }

  const state = classifyPublishState({ hasOwnGit, hasOrigin: remoteUrl !== "" });
  if (state === "already_published") {
    return {
      success: false,
      stage: "classify",
      reason: "This project is already published at " + remoteUrl + ". Taifa AI only publishes new projects, so push changes manually."
    };
  }
  if (state === "needs_remote") {
    return {
      success: false,
      stage: "classify",
      reason: "This project already has its own git repository but no GitHub remote. Taifa AI only publishes projects with no git history, so set up the remote manually."
    };
  }

  // From here on we are about to create .git ourselves, so any failure
  // removes it again and a retry starts from a clean state.
  const fail = (stage, reason) => {
    try {
      fs.rmSync(gitDir, { recursive: true, force: true });
    } catch (e) {
      // best effort
    }
    return { success: false, stage, reason };
  };

  const gitignorePath = path.join(projectDir, ".gitignore");
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  fs.writeFileSync(gitignorePath, mergeGitignore(existing));

  const init = await git(["init", "-b", "main"]);
  if (!init.success) return fail("init", "git init failed: " + (init.stderr || "unknown error"));

  const top = await git(["rev-parse", "--show-toplevel"]);
  if (!top.success || fs.realpathSync(top.stdout.trim()) !== fs.realpathSync(projectDir)) {
    return fail("verify", "The git repository root is not the project folder, so nothing was staged.");
  }

  const add = await git(["add", "-A"]);
  if (!add.success) return fail("stage", "git add failed: " + (add.stderr || "unknown error"));

  const staged = await git(["diff", "--cached", "--name-only", "-z"]);
  if (!staged.success) return fail("stage", "Could not list staged files: " + (staged.stderr || "unknown error"));
  const stagedFiles = staged.stdout.split("\0").filter(Boolean);
  if (stagedFiles.length === 0) return fail("stage", "There are no files to commit.");

  const secrets = detectSecretFiles(stagedFiles);
  if (secrets.length > 0) {
    return fail("secrets", "Refusing to publish: these files look like secrets: " + secrets.join(", ") + ".");
  }

  const commit = await git(["commit", "-m", FIRST_COMMIT_MESSAGE]);
  if (!commit.success) return fail("commit", "git commit failed: " + (commit.stderr || "unknown error"));

  const created = await run(
    "gh",
    ["repo", "create", repoName, "--private", "--source=.", "--remote=origin", "--push"],
    { cwd: projectDir, timeout: GH_TIMEOUT_MS }
  );
  if (!created.success) {
    return fail(
      "github",
      "gh repo create failed: " + (created.stderr || "unknown error") + " If the repository now exists on GitHub, delete or rename it before retrying."
    );
  }

  return { success: true, repoName, url: created.stdout.trim() || created.stderr.trim() };
}

module.exports = { publishNewProject, mergeGitignore, FIRST_COMMIT_MESSAGE };
