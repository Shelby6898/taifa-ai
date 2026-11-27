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


// Detect likely credentials in file contents.
// Returns categories only: never return or log the matched secret.
function detectSecretContent(content) {
  const text = String(content || "");
  const findings = new Set();

  const patterns = [
    ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/],
    ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
    ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}\b/],
    ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
    ["stripe_key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/],
    ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/]
  ];

  for (const [type, pattern] of patterns) {
    if (pattern.test(text)) findings.add(type);
  }

  const placeholders = new Set([
    "your_api_key",
    "your_api_key_here",
    "your_secret",
    "your_secret_key",
    "your_token",
    "your_password",
    "replace_me",
    "replace_with_your_key",
    "change_me",
    "changeme",
    "example",
    "example_token",
    "placeholder",
    "xxxxxxxx",
    "your_value"
  ]);

  const assignmentPattern =
    /^\s*(?:export\s+)?(?:(?:const|let|var)\s+)?(?:["']?)(api[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|password|passwd|access[_-]?key|auth[_-]?token|(?:api|access|refresh)[_-]?token)(?:["']?)\s*[:=]\s*["']?([^"'#\s,;]+)["']?/gim;

  let match;
  while ((match = assignmentPattern.exec(text)) !== null) {
    const value = match[2].trim();
    const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, "");

    if (
      value.length >= 8 &&
      !placeholders.has(normalized) &&
      !/^(?:process\.env|import\.meta\.env|os\.getenv|getenv)\b/i.test(value) &&
      !/^(?:\$\{|<|your[-_])/i.test(value) &&
      !/^(?:xxx+|000+|12345678+)$/.test(value)
    ) {
      findings.add("credential_assignment");
    }
  }

  return [...findings];
}

module.exports = {
  GITIGNORE_CONTENT,
  toRepoName,
  validateRepoName,
  classifyPublishState,
  detectSecretFiles,
  detectSecretContent
};
