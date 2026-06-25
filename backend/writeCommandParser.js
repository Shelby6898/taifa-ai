const SEPARATOR = "|";

// Matches "write to:" or "write to :" or "write to:   " etc. —
// tolerant of any amount of whitespace (including none) after the colon,
// since mobile keyboards inconsistently insert/collapse spaces there.
const WRITE_PATTERN = /^write to:\s*/;
const EDIT_PATTERN = /^edit:\s*/;

function parseWriteCommand(message) {
  if (!message || typeof message !== "string") {
    return { isWriteCommand: false };
  }

  const rawFirstLine = message.split("\n")[0];

  const firstLine =
    rawFirstLine.length > 0
      ? rawFirstLine[0].toLowerCase() + rawFirstLine.slice(1)
      : rawFirstLine;

  let mode = null;
  let afterPrefix = null;

  const writeMatch = firstLine.match(WRITE_PATTERN);
  const editMatch = firstLine.match(EDIT_PATTERN);

  if (writeMatch) {
    mode = "write";
    afterPrefix = firstLine.slice(writeMatch[0].length);
  } else if (editMatch) {
    mode = "edit";
    afterPrefix = firstLine.slice(editMatch[0].length);
  } else {
    return { isWriteCommand: false };
  }

  const separatorIndex = afterPrefix.indexOf(SEPARATOR);

  if (separatorIndex === -1) {
    return {
      isWriteCommand: true,
      mode,
      targetPath: afterPrefix.trim(),
      instruction: "",
      malformed: true
    };
  }

  const targetPath = afterPrefix.slice(0, separatorIndex).trim();
  const instruction = afterPrefix.slice(separatorIndex + 1).trim();

  return {
    isWriteCommand: true,
    mode,
    targetPath,
    instruction
  };
}

module.exports = { parseWriteCommand };
