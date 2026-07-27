const fs = require("fs");
const path = require("path");

function backupDirFor(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");
  return path.join(__dirname, "memory", "backups", `${studentId}__${projectName}`);
}

function backupFilePath(sessionKey, targetPath) {
  // Mirror the relative structure with slashes replaced, so nested
  // paths don't collide or require recreating subfolders inside backups/
  const safeName = targetPath.replace(/[\\/]/g, "__");
  return path.join(backupDirFor(sessionKey), `${safeName}.bak`);
}

function backupExistingFile(sessionKey, resolvedPath, targetPath) {
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  const backupDir = backupDirFor(sessionKey);
  fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = backupFilePath(sessionKey, targetPath);
  const content = fs.readFileSync(resolvedPath, "utf-8");

  fs.writeFileSync(backupPath, content);
  console.log(`[backupManager] Backed up ${targetPath} -> ${backupPath}`);

  return backupPath;
}

function restoreFromBackup(sessionKey, targetPath) {
  const backupPath = backupFilePath(sessionKey, targetPath);
  if (!fs.existsSync(backupPath)) {
    return { success: false, reason: "No backup found for this file" };
  }
  return { success: true, content: fs.readFileSync(backupPath, "utf-8") };
}

module.exports = { backupExistingFile, restoreFromBackup, backupFilePath };
