const INSTALL_PATTERN = /^install:\s*(.+)$/;

function parseInstallCommand(message) {
  if (!message || typeof message !== "string") {
    return { isInstallCommand: false };
  }

  const rawFirstLine = message.split("\n")[0];
  const firstLine =
    rawFirstLine.length > 0
      ? rawFirstLine[0].toLowerCase() + rawFirstLine.slice(1)
      : rawFirstLine;

  const match = firstLine.trim().match(INSTALL_PATTERN);

  if (!match) {
    return { isInstallCommand: false };
  }

  return { isInstallCommand: true, packageName: match[1].trim() };
}

module.exports = { parseInstallCommand };
