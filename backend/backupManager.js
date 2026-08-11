const fs = require("fs");
const path = require("path");
const { sanitizeKeyPart } = require("./sessionKey");

const BACKUPS_ROOT = path.join(__dirname, "memory", "backups");

function backupDirFor(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");

  if (!studentId || !projectName) {
    throw new Error("Invalid session key");
  }

  return path.join(
    BACKUPS_ROOT,
    `${sanitizeKeyPart(studentId)}__${sanitizeKeyPart(projectName)}`
  );
}

function backupFilePath(sessionKey, targetPath) {
  const safeName = targetPath.replace(/[\\/]/g, "__");

  return path.join(
    backupDirFor(sessionKey),
    `${safeName}.bak`
  );
}

function backupExistingFile(sessionKey, resolvedPath, targetPath) {
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  const backupDir = backupDirFor(sessionKey);

  fs.mkdirSync(backupDir, {
    recursive: true
  });

  const backupPath = backupFilePath(sessionKey, targetPath);

  const content = fs.readFileSync(resolvedPath, "utf-8");

  fs.writeFileSync(
    backupPath,
    content
  );

  console.log(
    `[backupManager] Backed up ${targetPath} -> ${backupPath}`
  );

  return backupPath;
}

function restoreFromBackup(sessionKey, targetPath) {
  const backupPath = backupFilePath(
    sessionKey,
    targetPath
  );

  if (!fs.existsSync(backupPath)) {
    return {
      success: false,
      reason: "No backup found for this file"
    };
  }

  return {
    success: true,
    content: fs.readFileSync(
      backupPath,
      "utf-8"
    )
  };
}

function deleteBackupsForProject(sessionKey) {
  const backupDir = backupDirFor(sessionKey);

  if (!fs.existsSync(backupDir)) {
    return {
      deleted: false,
      deletedFiles: []
    };
  }

  const deletedFiles = [];

  for (const entry of fs.readdirSync(backupDir, {
    withFileTypes: true
  })) {
    const entryPath = path.join(
      backupDir,
      entry.name
    );

    if (entry.isFile()) {
      fs.unlinkSync(entryPath);
      deletedFiles.push(entry.name);
    }
  }

  fs.rmSync(backupDir, {
    recursive: true,
    force: true
  });

  return {
    deleted: true,
    deletedFiles
  };
}

module.exports = {
  backupExistingFile,
  restoreFromBackup,
  backupFilePath,
  deleteBackupsForProject
};
