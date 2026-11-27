// Deterministic preview shown to the human before a publish is approved.
// Advisory only: publishNewProject re-runs every real check at approval.

const nodeFs = require("fs");
const path = require("path");
const { toRepoName, validateRepoName, detectSecretFiles, detectSecretContent } = require("./githubPublisher");

const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".cache", "__pycache__", ".git"]);
const SAFE_ENV_NAMES = new Set([".env.example", ".env.sample", ".env.template"]);
const MAX_FILES = 5000;
const PREVIEW_LIST_SIZE = 20;

// Mirrors what GITIGNORE_CONTENT excludes, so the preview does not
// call .env files "secrets that would be published".
function isIgnoredByDefault(filePath) {
  const base = filePath.split("/").pop();
  if (SAFE_ENV_NAMES.has(base)) return false;
  return base === ".env" || base.startsWith(".env.") || base.endsWith(".log");
}

function listProjectFiles(dir, fs) {
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (out.length > MAX_FILES) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(current, entry.name), prefix + entry.name + "/");
      } else if (entry.isFile()) {
        out.push(prefix + entry.name);
      }
    }
  };
  walk(dir, "");
  return out;
}


const MAX_CONTENT_FILE_BYTES = 1024 * 1024;
const MAX_CONTENT_SCAN_BYTES = 20 * 1024 * 1024;

function scanPublishContents(files, projectDir, fs) {
  const findings = [];
  let totalBytes = 0;

  for (const relativePath of files) {
    const fullPath = path.join(projectDir, relativePath);
    let content;

    try {
      content = fs.readFileSync(fullPath);
    } catch {
      return {
        ok: false,
        reason: "Could not safely scan file: " + relativePath
      };
    }

    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    if (buffer.length > MAX_CONTENT_FILE_BYTES) {
      return {
        ok: false,
        reason: "File exceeds the 1 MB content-scanning limit: " + relativePath
      };
    }

    totalBytes += buffer.length;
    if (totalBytes > MAX_CONTENT_SCAN_BYTES) {
      return {
        ok: false,
        reason: "Project exceeds the 20 MB total content-scanning limit."
      };
    }

    // Binary files are not treated as text credentials.
    if (buffer.includes(0)) continue;

    const categories = detectSecretContent(buffer.toString("utf8"));
    if (categories.length > 0) {
      findings.push({
        path: relativePath,
        categories
      });
    }
  }

  return { ok: true, findings };
}

function buildPublishPreview({ projectDir, projectName, fs = nodeFs }) {
  const repoName = toRepoName(projectName);
  const nameCheck = validateRepoName(repoName);
  if (!nameCheck.valid) return { ok: false, reason: nameCheck.reason };

  if (!fs.existsSync(projectDir)) {
    return { ok: false, reason: "Project folder does not exist." };
  }
  if (fs.existsSync(path.join(projectDir, ".git"))) {
    return {
      ok: false,
      reason: "This project already has its own git repository. Taifa AI only publishes new projects, so push changes manually."
    };
  }

  const all = listProjectFiles(projectDir, fs);
  if (all.length > MAX_FILES) {
    return { ok: false, reason: "This project has more than " + MAX_FILES + " files, which is too many to preview safely." };
  }

  const files = all.filter((p) => !isIgnoredByDefault(p));
  if (files.length === 0) return { ok: false, reason: "There are no files to publish." };

  const blocking = detectSecretFiles(files);
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: "Refusing to propose a publish: these files look like secrets and are not covered by .gitignore: " + blocking.join(", ") + "."
    };
  }

  const contentScan = scanPublishContents(files, projectDir, fs);
  if (!contentScan.ok) {
    return { ok: false, reason: contentScan.reason };
  }

  if (contentScan.findings.length > 0) {
    const details = contentScan.findings.map(
      (item) => item.path + " (" + item.categories.join(", ") + ")"
    );
    return {
      ok: false,
      reason: "Refusing to propose a publish: possible credentials found in file contents: " + details.join("; ") + ". Remove them or replace them with environment-variable references."
    };
  }

  return {
    ok: true,
    repoName,
    visibility: "private",
    fileCount: files.length,
    filesPreview: files.slice(0, PREVIEW_LIST_SIZE),
    moreFiles: Math.max(0, files.length - PREVIEW_LIST_SIZE)
  };
}

module.exports = { buildPublishPreview, isIgnoredByDefault };
