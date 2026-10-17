// Pure decision logic for publishing a generated project to GitHub.
// No git or gh calls here, so all of it is unit-testable. The command
// runner is added separately and injected.

const REPO_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/;

const GITIGNORE_CONTENT = [
  "node_modules/",
  "dist/",
  "build/",
  ".cache/",
  "__pycache__/",
  "*.log",
  ".env",
  ".env.*",
  "!.env.example",
  ""
].join("\n");

const SAFE_ENV_NAMES = new Set([".env.example", ".env.sample", ".env.template"]);

function toRepoName(projectName) {
  return String(projectName || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 100);
}

function validateRepoName(name) {
  if (typeof name !== "string" || !REPO_NAME_PATTERN.test(name)) {
    return { valid: false, reason: "Repository name must be 1-100 characters of lowercase letters, digits, '.', '_' or '-', starting with a letter or digit." };
  }
  if (name.endsWith(".git")) {
    return { valid: false, reason: 'Repository name cannot end with ".git".' };
  }
  return { valid: true };
}

// needs_init: no .git of its own. needs_remote: own repo, no origin.
// already_published: own repo with an origin (version 1 never pushes these).
function classifyPublishState({ hasOwnGit, hasOrigin }) {
  if (!hasOwnGit) return "needs_init";
  return hasOrigin ? "already_published" : "needs_remote";
}

// Takes the list of paths that WOULD be staged and returns any that look
// like secrets, so publishing can refuse before anything is committed.
function detectSecretFiles(filePaths) {
  return filePaths.filter((p) => {
    const base = p.split("/").pop();
    if (SAFE_ENV_NAMES.has(base)) return false;
    return (
      base === ".env" ||
      base.startsWith(".env.") ||
      base === "id_rsa" ||
      /\.(pem|key)$/.test(base)
    );
  });
}

module.exports = {
  GITIGNORE_CONTENT,
  toRepoName,
  validateRepoName,
  classifyPublishState,
  detectSecretFiles
};
