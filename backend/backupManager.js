const fs = require("fs");
const path = require("path");

const BACKUP_DIR = path.join(__dirname, "memory", "backups");

function backupFilePath(targetPath) {
  // Mirror the relative structure with slashes replaced, so nested
  // paths don't collide or require recreating subfolders inside backups/
  const safeName = targetPath.replace(/[\\/]/g, "__");
  return path.join(BACKUP_DIR, `${safeName}.bak`);
}

function backupExistingFile(resolvedPath, targetPath) {
  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const backupPath = backupFilePath(targetPath);
  const content = fs.readFileSync(resolvedPath, "utf-8");

  fs.writeFileSync(backupPath, content);
  console.log(`[backupManager] Backed up ${targetPath} -> ${backupPath}`);

  return backupPath;
}

function restoreFromBackup(targetPath) {
  const backupPath = backupFilePath(targetPath);
  if (!fs.existsSync(backupPath)) {
    return { success: false, reason: "No backup found for this file" };
  }
  return { success: true, content: fs.readFileSync(backupPath, "utf-8") };
}

module.exports = { backupExistingFile, restoreFromBackup, backupFilePath };
