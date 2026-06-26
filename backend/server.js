const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { backupExistingFile } = require("./backupManager");
const { searchIndex, buildIndex, startWatching } = require("./fileIndexer");
const { parseWriteCommand } = require("./writeCommandParser");
const { isPathSafe } = require("./pathSafety");
const { generateFileContent, generateFix } = require("./generateFileContent");
const { stripCodeFences } = require("./stripCodeFences");
const { parseFixCommand } = require("./fixCommandParser");
const { findWorkspaceRelativePath } = require("./extractErrorPath");
const { buildTree } = require("./fileTree");
const { parseRememberCommand } = require("./rememberCommandParser");
const { addFact, formatMemoryBlock } = require("./projectMemory");

const app = express();

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL_NAME = "qwen2.5-coder:1.5b";
const MAX_HISTORY_TURNS = 3;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    success: true,
    application: "Taifa AI",
    version: "0.1.0",
    status: "running"
  });
});

app.post("/api/reindex", (req, res) => {
  try {
    const index = buildIndex();
    res.json({ success: true, filesIndexed: index.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return "";
  }
  const trimmed = history.slice(-MAX_HISTORY_TURNS * 2);
  const lines = trimmed.map((msg) => {
    const speaker = msg.role === "user" ? "User" : "Assistant";
    return `${speaker}: ${msg.content}`;
  });
  return `Conversation history:\n${lines.join("\n")}\n\n`;
}

function buildFullPrompt(userPrompt, history) {
  const memoryBlock = formatMemoryBlock();
  const historyBlock = formatHistory(history);
  const matches = searchIndex(userPrompt, 3);
  let contextBlock = "";
  if (matches.length > 0) {
    const contextBlocks = matches
      .map((file) => `--- ${file.path} ---\n${file.snippet}`)
      .join("\n\n");
    contextBlock = `Context from project files:\n\n${contextBlocks}\n\n`;
  }
  return `${memoryBlock}${historyBlock}${contextBlock}User question: ${userPrompt}`;
}

async function handleWriteCommand(parsedCommand, res) {
  if (parsedCommand.malformed) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: "Command format is incomplete. Use: write to: path.js | instruction"
    });
  }

  const { mode, targetPath, instruction } = parsedCommand;

  const safetyCheck = isPathSafe(targetPath);

  if (!safetyCheck.safe) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: safetyCheck.reason,
      attemptedPath: targetPath
    });
  }

  let existingContent = null;
  let fileExists = false;

  try {
    existingContent = fs.readFileSync(safetyCheck.resolvedPath, "utf-8");
    fileExists = true;
  } catch (err) {
    fileExists = false;
  }

  try {
    const rawGenerated = await generateFileContent({
      mode,
      targetPath,
      instruction,
      existingContent: fileExists ? existingContent : null
    });

    const cleanedContent = stripCodeFences(rawGenerated);

    return res.json({
      success: true,
      action: "propose_write",
      mode,
      targetPath,
      resolvedPath: safetyCheck.resolvedPath,
      fileExists,
      before: fileExists ? existingContent : "",
      after: cleanedContent
    });
  } catch (err) {
    console.error("Content generation failed:", err.message);
    return res.status(500).json({
      success: false,
      action: "generation_failed",
      reason: err.message
    });
  }
}

async function handleFixCommand(fixCommand, res) {
  if (fixCommand.malformed) {
    return res.status(400).json({
      success: false,
      action: "fix_rejected",
      reason: "No error text provided. Use: fix this: <paste your error or stack trace>"
    });
  }

  const { errorText } = fixCommand;
  const workspaceDir = require("path").join(__dirname, "..", "workspace");

  let relativePath = findWorkspaceRelativePath(errorText, workspaceDir);
  let locationMethod = "stack_trace";

  if (!relativePath) {
    const matches = searchIndex(errorText, 1);
    if (matches.length > 0) {
      relativePath = matches[0].path;
      locationMethod = "keyword_search";
    }
  }

  if (!relativePath) {
    return res.json({
      success: false,
      action: "fix_not_located",
      reason: "Could not locate a relevant file from this error. Try including a stack trace, or mention the filename directly."
    });
  }

  const safetyCheck = isPathSafe(relativePath);
  if (!safetyCheck.safe) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: safetyCheck.reason,
      attemptedPath: relativePath
    });
  }

  let existingContent;
  try {
    existingContent = fs.readFileSync(safetyCheck.resolvedPath, "utf-8");
  } catch (err) {
    return res.status(400).json({
      success: false,
      action: "fix_rejected",
      reason: `Located path ${relativePath} but could not read it: ${err.message}`
    });
  }

  try {
    const rawGenerated = await generateFix({
      targetPath: relativePath,
      errorText,
      existingContent
    });

    const cleanedContent = stripCodeFences(rawGenerated);

    return res.json({
      success: true,
      action: "propose_write",
      mode: "edit",
      targetPath: relativePath,
      resolvedPath: safetyCheck.resolvedPath,
      fileExists: true,
      before: existingContent,
      after: cleanedContent,
      locationMethod
    });
  } catch (err) {
    console.error("Fix generation failed:", err.message);
    return res.status(500).json({
      success: false,
      action: "generation_failed",
      reason: err.message
    });
  }
}

app.post("/api/chat", async (req, res) => {
  const { prompt, history } = req.body;

  if (!prompt) {
    return res.status(400).json({ success: false, error: "prompt is required" });
  }

  const rememberCommand = parseRememberCommand(prompt);
  if (rememberCommand.isRememberCommand) {
    if (rememberCommand.malformed) {
      return res.status(400).json({
        success: false,
        action: "remember_rejected",
        reason: "No fact provided. Use: remember: some fact about this project"
      });
    }
    const result = addFact(rememberCommand.fact);
    return res.json({
      success: true,
      action: "fact_remembered",
      fact: rememberCommand.fact,
      alreadyKnown: !result.added,
      totalFacts: result.facts.length
    });
  }

  const parsedCommand = parseWriteCommand(prompt);
  if (parsedCommand.isWriteCommand) {
    return handleWriteCommand(parsedCommand, res);
  }

  const fixCommand = parseFixCommand(prompt);
  if (fixCommand.isFixCommand) {
    return handleFixCommand(fixCommand, res);
  }

  const fullPrompt = buildFullPrompt(prompt, history);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const response = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      {
        model: MODEL_NAME,
        prompt: fullPrompt,
        stream: true
      },
      { responseType: "stream" }
    );

    response.data.on("data", (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            res.write(`data: ${JSON.stringify({ token: parsed.response })}\n\n`);
          }
          if (parsed.done) {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();
          }
        } catch (e) {
          // partial JSON chunk from Ollama, ignore and wait for next chunk
        }
      }
    });

    response.data.on("error", (err) => {
      console.error("Ollama stream error:", err.message);
      res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
      res.end();
    });
  } catch (error) {
    console.error("Ollama request failed:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/write", (req, res) => {
  const { targetPath, content } = req.body;

  if (!targetPath || typeof content !== "string") {
    return res.status(400).json({ success: false, error: "targetPath and content are required" });
  }

  // NEVER trust that a path was already validated in a previous request.
  // Re-check it fresh, here, right before any disk write happens.
  const safetyCheck = isPathSafe(targetPath);

  if (!safetyCheck.safe) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: safetyCheck.reason,
      attemptedPath: targetPath
    });
  }

  try {
    const backupPath = backupExistingFile(safetyCheck.resolvedPath, targetPath);

    fs.mkdirSync(path.dirname(safetyCheck.resolvedPath), { recursive: true });
    fs.writeFileSync(safetyCheck.resolvedPath, content, "utf-8");

    console.log(`[api/write] Wrote ${content.length} bytes to ${targetPath}`);

    return res.json({
      success: true,
      action: "write_complete",
      targetPath,
      bytesWritten: content.length,
      backupCreated: backupPath !== null,
      backupPath
    });
  } catch (err) {
    console.error("[api/write] Write failed:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/files", (req, res) => {
  try {
    const tree = buildTree();
    res.json({ success: true, tree });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(5000, () => {
  console.log("Taifa AI Backend running on port 5000");
  startWatching();
});
