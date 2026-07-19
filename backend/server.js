require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { backupExistingFile } = require("./backupManager");
const { searchIndex, buildIndex, startWatching, formatFullIndex } = require("./fileIndexer");
const { parseWriteCommand } = require("./writeCommandParser");
const { isPathSafe } = require("./pathSafety");
const { generateFileContent, generateFix, generateDocumentation, generatePlan, generateSelfReview, generateTestFile, generateClarifyingQuestions, generateBlueprint } = require("./generateFileContent");
const { parseTestGenerationCommand } = require("./testGenerationCommandParser");
const { parseExecutePlanCommand } = require("./executePlanCommandParser");
const { parseSelfReview } = require("./selfReviewParser");
const { stripCodeFences } = require("./stripCodeFences");
const { lenientJsonParse } = require("./lenientJsonParse");
const { parseFixCommand } = require("./fixCommandParser");
const { findWorkspaceRelativePath } = require("./extractErrorPath");
const { parseDocumentCommand } = require("./documentCommandParser");
const { parseTestCommand } = require("./testCommandParser");
const { parseGitCommand } = require("./gitCommandParser");
const { parseInstallCommand } = require("./installCommandParser");
const { isGitRepo, getStatus, getDiff, commitChanges, detectRiskyPaths } = require("./gitTool");
const { installPackage } = require("./packageManagerTool");
const { hasPendingAction, getPendingAction, createPendingAction, isValidActionId, clearPendingAction } = require("./toolActionState");
const { runTests } = require("./testRunner");
const { buildTree } = require("./fileTree");
const { parseRememberCommand } = require("./rememberCommandParser");
const { parsePlanCommand } = require("./planCommandParser");
const { hasPendingPlan, createPlan, getPendingPlan, enrichWithDiffs, clearPlan, isValidPlanId, hasActiveCampaign, getActiveCampaign, startCampaign, recordBatchCompletion, takeNextBatch, clearCampaign } = require("./planState");
const { hasPendingClarification, getPhase, startClarification, recordAnswer, isComplete, getCurrentQuestion, getPendingClarification, buildRequirementsSummary, setPhase, setEnrichedDescription, getEnrichedDescription, beginArchitectureConfirmation, getRelevantFiles, beginBlueprintConfirmation, getBlueprint, clearClarification } = require("./clarificationState");
const { FIXED_PLANNING_QUESTIONS, SHORT_PLANNING_QUESTIONS } = require("./planningQuestions");
const { addFact, formatMemoryBlock } = require("./projectMemory");
const authRoutes = require("./authRoutes");
const { requireAuth } = require("./authMiddleware");

const app = express();

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL_NAME = "qwen2.5-coder-6k";

function syncReindexWorkspace() {
  buildIndex();
  const { buildImportGraph } = require("./importGraphBuilder");
  buildImportGraph();
  const { buildFunctionIndex } = require("./functionIndexBuilder");
  buildFunctionIndex();
  const { buildComponentGraph } = require("./componentGraphBuilder");
  buildComponentGraph();
  const { buildDbSchemaGraph } = require("./dbSchemaBuilder");
  buildDbSchemaGraph();
}

// Deterministic safety net for the technology-naming instruction in
// buildPlanPrompt. Prompt engineering alone was tested three ways
// (basic rule, recency-positioned reminder, concrete before/after
// example) and reliably stops the model from naming the WRONG
// technology, but does not reliably make it proactively name the
// RIGHT one in every relevant file. Since the correct technology is
// already known as structured data (blueprint.database), fix it here
// with plain string logic instead of continuing to trust the model.
const STORAGE_PATH_HINT = /\/models\//i;
const STORAGE_KEYWORD_HINT = /model|schema|database|persist|collection|document|repository/i;

function annotateStorageFiles(fileList, blueprint) {
  if (!blueprint || !blueprint.database) return fileList;

  const dbName = blueprint.database;
  const escaped = dbName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alreadyNamedPattern = new RegExp(escaped, "i");

  return fileList.map((f) => {
    const touchesStorage = STORAGE_PATH_HINT.test(f.path) || STORAGE_KEYWORD_HINT.test(f.description);
    const alreadyNamed = alreadyNamedPattern.test(f.description);

    if (touchesStorage && !alreadyNamed) {
      return { ...f, description: `${f.description} (uses ${dbName}, per agreed architecture)` };
    }
    return f;
  });
}

async function generateBatchPlan({ description, completedFiles, blueprint }) {
  const MAX_PLAN_FILES = 5;
  const fullIndex = formatFullIndex(description);
  const rawPlan = await generatePlan({ description, fullIndex, completedFiles });
  const cleanedPlan = stripCodeFences(rawPlan);
  const parsedFiles = lenientJsonParse(cleanedPlan);

  if (!Array.isArray(parsedFiles)) {
    throw new Error("Generated plan was not a JSON array");
  }

  const seenPaths = new Set();
  const dedupedFiles = parsedFiles.filter((f) => {
    if (seenPaths.has(f.path)) return false;
    seenPaths.add(f.path);
    return true;
  });

  const annotatedFiles = annotateStorageFiles(dedupedFiles, blueprint);

  let droppedFiles = null;
  let files = annotatedFiles;

  if (files.length > MAX_PLAN_FILES) {
    droppedFiles = files.slice(MAX_PLAN_FILES);
    files = files.slice(0, MAX_PLAN_FILES);
  }

  const truncatedFiles = droppedFiles ? droppedFiles.map((f) => f.path) : null;

  return { files, truncated: droppedFiles !== null, truncatedFiles, droppedFiles };
}

const MAX_HISTORY_TURNS = 3;
app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    application: "Taifa AI",
    version: "0.1.0",
    status: "running"
  });
});

app.post("/api/reindex", requireAuth, (req, res) => {
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
    const { checkSyntax } = require("./syntaxChecker");
    const syntaxResult = checkSyntax(cleanedContent);
    const { checkImports } = require("./importChecker");
    const importResult = checkImports(cleanedContent, safetyCheck.resolvedPath);
    const { checkLint } = require("./lintChecker");
    const lintResult = checkLint(cleanedContent);
    const { runTestsAgainstProposal } = require("./testRunner");
    const testCheck = runTestsAgainstProposal(safetyCheck.resolvedPath, cleanedContent);

    if (testCheck.hasTests && !testCheck.passed) {
      return res.json({
        success: true,
        action: "generation_refused",
        reason: "The existing test suite fails against this proposed change.",
        testCheck,
        syntaxCheck: syntaxResult,
        importCheck: importResult
      });
    }

    return res.json({
      success: true,
      action: "propose_write",
      mode,
      targetPath,
      resolvedPath: safetyCheck.resolvedPath,
      fileExists,
      before: fileExists ? existingContent : "",
      after: cleanedContent,
      syntaxCheck: syntaxResult,
      importCheck: importResult,
      lintCheck: lintResult,
      testCheck,
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

async function handleWriteTestsCommand(targetPath, res) {
  const sourceSafetyCheck = isPathSafe(targetPath);

  if (!sourceSafetyCheck.safe) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: sourceSafetyCheck.reason,
      attemptedPath: targetPath
    });
  }

  let sourceContent;
  try {
    sourceContent = fs.readFileSync(sourceSafetyCheck.resolvedPath, "utf-8");
  } catch (err) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: "Could not read " + targetPath + " — it may not exist: " + err.message
    });
  }

  const testFilePath = targetPath.replace(/\.(js|jsx|ts|tsx)$/, ".test.$1");
  const testSafetyCheck = isPathSafe(testFilePath);

  if (!testSafetyCheck.safe) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: testSafetyCheck.reason,
      attemptedPath: testFilePath
    });
  }

  let existingTestContent = null;
  let testFileExists = false;
  try {
    existingTestContent = fs.readFileSync(testSafetyCheck.resolvedPath, "utf-8");
    testFileExists = true;
  } catch (err) {
    testFileExists = false;
  }

  try {
    const { getModuleSystemForPath, detectModuleSystemMismatch } = require("./moduleSystemDetector");
    const requiredModuleSystem = getModuleSystemForPath(testSafetyCheck.resolvedPath);

    const rawGenerated = await generateTestFile({
      sourceFilePath: targetPath,
      sourceFileContent: sourceContent,
      testFilePath,
      existingTestContent: testFileExists ? existingTestContent : null,
      moduleSystem: requiredModuleSystem
    });

    const cleanedContent = stripCodeFences(rawGenerated);

    const moduleMismatch = detectModuleSystemMismatch(cleanedContent, requiredModuleSystem);

    if (moduleMismatch.mismatch) {
      return res.json({
        success: true,
        action: "test_generation_refused",
        message: "Refusing to propose this generated test — " + moduleMismatch.reason
      });
    }

    const { checkSyntax } = require("./syntaxChecker");
    const syntaxResult = checkSyntax(cleanedContent);
    const { checkImports } = require("./importChecker");
    const importResult = checkImports(cleanedContent, testSafetyCheck.resolvedPath);

    if (!syntaxResult.valid || importResult.hasMissing) {
      return res.json({
        success: true,
        action: "test_generation_refused",
        message: !syntaxResult.valid
          ? "Refusing to propose this generated test — syntax error: " + syntaxResult.message
          : "Refusing to propose this generated test — it references a file or export that doesn't exist.",
        syntaxCheck: syntaxResult,
        importCheck: importResult
      });
    }

    const { checkLint } = require("./lintChecker");
    const lintResult = checkLint(cleanedContent);
    const { runGeneratedTestFile } = require("./testRunner");
    // Write the proposed test content to disk temporarily and actually
    // run it, to check that the newly generated test itself passes
    // against the real, unchanged source file it's meant to test.
    const fsSync = require("fs");
    fsSync.writeFileSync(testSafetyCheck.resolvedPath, cleanedContent, "utf-8");
    const testCheck = runGeneratedTestFile(testSafetyCheck.resolvedPath);

    if (testCheck.hasTests && !testCheck.passed) {
      return res.json({
        success: true,
        action: "test_generation_refused",
        message: "The generated test file does not actually pass when run against the real source file.",
        testCheck,
        syntaxCheck: syntaxResult,
        importCheck: importResult
      });
    }

    return res.json({
      success: true,
      action: "propose_write",
      mode: testFileExists ? "edit" : "write",
      targetPath: testFilePath,
      resolvedPath: testSafetyCheck.resolvedPath,
      fileExists: testFileExists,
      before: testFileExists ? existingTestContent : "",
      after: cleanedContent,
      syntaxCheck: syntaxResult,
      importCheck: importResult,
      lintCheck: lintResult,
      testCheck,
      isTestGeneration: true
    });
  } catch (err) {
    console.error("Test generation failed:", err.message);
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
    const matches = searchIndex(errorText, 1, [".md"]);
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
    const { checkSyntax } = require("./syntaxChecker");
    const syntaxResult = checkSyntax(cleanedContent);
    const { checkImports } = require("./importChecker");
    const importResult = checkImports(cleanedContent, safetyCheck.resolvedPath);
    const { checkLint } = require("./lintChecker");
    const lintResult = checkLint(cleanedContent);
    const { runTestsAgainstProposal } = require("./testRunner");
    const testCheck = runTestsAgainstProposal(safetyCheck.resolvedPath, cleanedContent);

    if (testCheck.hasTests && !testCheck.passed) {
      return res.json({
        success: true,
        action: "generation_refused",
        reason: "The existing test suite fails against this proposed fix.",
        testCheck,
        syntaxCheck: syntaxResult,
        importCheck: importResult
      });
    }

    return res.json({
      success: true,
      action: "propose_write",
      mode: "edit",
      targetPath: relativePath,
      resolvedPath: safetyCheck.resolvedPath,
      fileExists: true,
      before: existingContent,
      after: cleanedContent,
      syntaxCheck: syntaxResult,
      importCheck: importResult,
      lintCheck: lintResult,
      testCheck,
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

async function handleDocumentCommand(res) {
  const fullIndex = formatFullIndex();

  if (!fullIndex) {
    return res.json({
      success: false,
      action: "fix_not_located",
      reason: "No files found in workspace to document."
    });
  }

  const targetPath = "README.md";
  const safetyCheck = isPathSafe(targetPath);

  if (!safetyCheck.safe) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: safetyCheck.reason
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
    const rawGenerated = await generateDocumentation({ fullIndex });
    const cleanedContent = stripCodeFences(rawGenerated);

    return res.json({
      success: true,
      action: "propose_write",
      mode: fileExists ? "edit" : "write",
      targetPath,
      resolvedPath: safetyCheck.resolvedPath,
      fileExists,
      before: fileExists ? existingContent : "",
      after: cleanedContent,
      isDocumentation: true
    });
  } catch (err) {
    console.error("Documentation generation failed:", err.message);
    return res.status(500).json({
      success: false,
      action: "generation_failed",
      reason: err.message
    });
  }
}

async function handleRunTestsCommand(res) {
  try {
    const result = await runTests();

    if (!result.success) {
      return res.json({
        success: true,
        action: "tests_not_found",
        message: result.reason
      });
    }

    return res.json({
      success: true,
      action: "tests_ran",
      projectDir: result.projectDir,
      passed: !result.exitedWithError,
      timedOut: result.timedOut === true,
      stdout: result.stdout,
      stderr: result.stderr
    });
  } catch (err) {
    console.error("Test execution failed:", err.message);
    return res.status(500).json({
      success: false,
      action: "test_execution_failed",
      reason: err.message
    });
  }
}

async function handleGitStatusCommand(res) {
  const result = await getStatus();

  if (!result.success && result.reason) {
    return res.json({ success: true, action: "git_not_repo", message: result.reason });
  }

  return res.json({
    success: true,
    action: "git_status",
    stdout: result.stdout || "(no changes)",
    stderr: result.stderr
  });
}

async function handleGitDiffCommand(res) {
  const result = await getDiff();

  if (!result.success && result.reason) {
    return res.json({ success: true, action: "git_not_repo", message: result.reason });
  }

  return res.json({
    success: true,
    action: "git_diff",
    stdout: result.stdout || "(no differences)",
    stderr: result.stderr
  });
}

async function handleGitCommitCommand(res) {
  if (!isGitRepo()) {
    return res.json({ success: true, action: "git_not_repo", message: "The workspace is not a git repository." });
  }

  if (hasPendingAction()) {
    return res.status(409).json({
      success: false,
      action: "action_rejected",
      reason: "Another action is already pending approval. Approve or reject it first."
    });
  }

  const diffResult = await getDiff();
  const diffText = diffResult.stdout || "";

  if (!diffText.trim()) {
    return res.json({ success: true, action: "git_nothing_to_commit", message: "No uncommitted changes found." });
  }

  const statusResult = await getStatus();
  const riskyPaths = detectRiskyPaths(statusResult.stdout || "");

  if (riskyPaths.length > 0) {
    return res.json({
      success: true,
      action: "git_commit_refused",
      message: "Refusing to propose a commit — the change includes what looks like generated/vendor content (" + riskyPaths.join(", ") + "). This is usually node_modules or build output that shouldn't be committed. Add it to .gitignore and clean up the git index before committing."
    });
  }

  try {
    const truncatedDiff = diffText.length > 3000 ? diffText.slice(0, 3000) + "\n[diff truncated]" : diffText;
    const prompt = "Write a single concise git commit message (one line, under 72 characters, no quotes, no prefix like \"feat:\" unless genuinely appropriate) summarizing this diff:\n\n" + truncatedDiff + "\n\nOutput ONLY the commit message text, nothing else.";

    const response = await axios.post(OLLAMA_URL + "/api/generate", {
      model: MODEL_NAME,
      prompt,
      stream: false
    });

    const cleanedResponse = stripCodeFences(response.data.response);
    const suggestedMessage = cleanedResponse.trim().split("\n").filter((line) => line.trim().length > 0)[0].replace(/^`+|`+$/g, "").trim().slice(0, 200);

    const action = createPendingAction({
      type: "git_commit",
      payload: { message: suggestedMessage, diffPreview: truncatedDiff }
    });

    return res.json({
      success: true,
      action: "commit_proposed",
      actionId: action.id,
      message: suggestedMessage,
      diffPreview: truncatedDiff
    });
  } catch (err) {
    console.error("Commit message generation failed:", err.message);
    return res.status(500).json({ success: false, action: "generation_failed", reason: err.message });
  }
}

async function handleInstallCommand(installCommand, res) {
  if (hasPendingAction()) {
    return res.status(409).json({
      success: false,
      action: "action_rejected",
      reason: "Another action is already pending approval. Approve or reject it first."
    });
  }

  const action = createPendingAction({
    type: "install",
    payload: { packageName: installCommand.packageName }
  });

  return res.json({
    success: true,
    action: "install_proposed",
    actionId: action.id,
    packageName: installCommand.packageName
  });
}

app.post("/api/tool-action/approve", requireAuth, async (req, res) => {
  const { actionId } = req.body;

  if (!isValidActionId(actionId)) {
    return res.status(400).json({ success: false, reason: "No matching pending action to approve." });
  }

  const action = getPendingAction();

  try {
    if (action.type === "git_commit") {
      const result = await commitChanges(action.payload.message);
      clearPendingAction();

      if (!result.success) {
        return res.json({ success: true, action: "commit_failed", reason: result.reason });
      }

      return res.json({ success: true, action: "commit_applied", stdout: result.stdout });
    }

    if (action.type === "install") {
      const result = await installPackage(action.payload.packageName);
      clearPendingAction();

      if (!result.success) {
        return res.json({
          success: true,
          action: "install_failed",
          reason: result.reason || result.stderr || result.errorMessage
        });
      }

      return res.json({
        success: true,
        action: "install_applied",
        projectDir: result.projectDir,
        stdout: result.stdout
      });
    }

    clearPendingAction();
    return res.status(400).json({ success: false, reason: "Unknown pending action type." });
  } catch (err) {
    clearPendingAction();
    console.error("Tool action execution failed:", err.message);
    return res.status(500).json({ success: false, reason: err.message });
  }
});

app.post("/api/tool-action/reject", requireAuth, (req, res) => {
  const { actionId } = req.body;

  if (!isValidActionId(actionId)) {
    return res.status(400).json({ success: false, reason: "No matching pending action to reject." });
  }

  clearPendingAction();
  return res.json({ success: true, action: "action_cleared" });
});

async function handlePlanCommand(planCommand, res) {
  if (planCommand.malformed) {
    return res.status(400).json({
      success: false,
      action: "plan_rejected",
      reason: "No description provided. Use: plan: <description of what you want built>"
    });
  }

  if (hasPendingPlan()) {
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A plan is already pending review. Approve or reject it before starting a new one."
    });
  }

  if (hasActiveCampaign()) {
    const campaign = getActiveCampaign();
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A multi-batch task is already in progress (batch " + campaign.batchNumber + "). Approve or reject the current batch before starting something new."
    });
  }

  if (hasPendingClarification()) {
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A clarification session is already in progress. Answer the pending question before starting something new."
    });
  }
  const memoryBlock = formatMemoryBlock();
  const hasMemory = memoryBlock.length > 0;
  const questions = hasMemory ? SHORT_PLANNING_QUESTIONS : FIXED_PLANNING_QUESTIONS;
  const memoryContext = hasMemory ? memoryBlock : null;

  startClarification({ description: planCommand.description, questions, memoryContext });

  return res.json({
    success: true,
    action: "clarification_question",
    question: getCurrentQuestion(),
    questionNumber: 1,
    totalQuestions: questions.length,
    usingProjectMemory: hasMemory
  });


}

// Shared by both the direct plan: <description> flow (once clarifying
// questions are answered) and any future caller that already has a
// complete description. Kept separate from handlePlanCommand so the
// clarification step can wrap around this without duplicating the
// actual plan-generation logic.
async function generateAndReturnPlan(description, res, blueprint) {
  try {
    const { files: parsedFiles, truncated, truncatedFiles, droppedFiles } = await generateBatchPlan({
      description,
      completedFiles: [],
      blueprint
    });

    if (!Array.isArray(parsedFiles) || parsedFiles.length === 0) {
      return res.status(500).json({
        success: false,
        action: "plan_rejected",
        reason: "The generated plan did not contain any files."
      });
    }

    let campaignInfo = null;
    if (truncated) {
      const campaign = startCampaign({ description, remainingFiles: droppedFiles });
      campaignInfo = { campaignId: campaign.id, batchNumber: campaign.batchNumber };
    }

    const plan = createPlan({ description, files: parsedFiles });

    return res.json({
      success: true,
      action: "plan_proposed",
      planId: plan.id,
      description: plan.description,
      files: plan.files,
      truncated,
      truncatedFiles,
      campaign: campaignInfo
    });
  } catch (err) {
    console.error("Plan generation failed:", err.message);
    return res.status(500).json({
      success: false,
      action: "generation_failed",
      reason: err.message
    });
  }
}


function handleExecutePlanCommand(executePlanCommand, res) {
  if (executePlanCommand.malformed) {
    return res.status(400).json({
      success: false,
      action: "plan_rejected",
      reason: executePlanCommand.reason
    });
  }

  if (hasPendingPlan()) {
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A plan is already pending review. Approve or reject it before starting a new one."
    });
  }

  if (hasActiveCampaign()) {
    const campaign = getActiveCampaign();
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A multi-batch task is already in progress (batch " + campaign.batchNumber + "). Approve or reject the current batch before starting something new."
    });
  }

  const MAX_PLAN_FILES = 5;
  let files = executePlanCommand.files;
  let droppedFiles = null;
  let truncated = false;

  if (files.length > MAX_PLAN_FILES) {
    droppedFiles = files.slice(MAX_PLAN_FILES);
    files = files.slice(0, MAX_PLAN_FILES);
    truncated = true;
  }

  let campaignInfo = null;
  if (truncated) {
    const campaign = startCampaign({ description: executePlanCommand.description, remainingFiles: droppedFiles });
    campaignInfo = { campaignId: campaign.id, batchNumber: campaign.batchNumber };
  }

  const plan = createPlan({ description: executePlanCommand.description, files });

  return res.json({
    success: true,
    action: "plan_proposed",
    planId: plan.id,
    description: plan.description,
    files: plan.files,
    truncated,
    truncatedFiles: droppedFiles ? droppedFiles.map((f) => f.path) : null,
    campaign: campaignInfo,
    isHumanSupplied: true
  });
}

app.post("/api/chat", requireAuth, async (req, res) => {
  const { prompt, history } = req.body;

  if (!prompt) {
    return res.status(400).json({ success: false, error: "prompt is required" });
  }
  if (hasPendingClarification()) {
    const phase = getPhase();
    const trimmedPrompt = prompt.trim();
    const confirmPattern = /^(yes|yep|yeah|correct|looks good|proceed|go ahead|that'?s right|sounds good|confirmed|ok|okay|approve)\b/i;

    const looksLikeNewPlanCommand = /^plan:\s*/i.test(trimmedPrompt) || /^execute plan:\s*/i.test(trimmedPrompt);
    const looksLikeCancel = /^cancel$/i.test(trimmedPrompt);

    if (looksLikeCancel) {
      const cancelledDescription = getPendingClarification().description;
      clearClarification();
      return res.json({
        success: true,
        action: "clarification_cancelled",
        message: "Cancelled the pending clarification for \"" + cancelledDescription + "\". You can start a new plan: request now."
      });
    }

    if (looksLikeNewPlanCommand) {
      const pending = getPendingClarification();
      return res.status(409).json({
        success: false,
        action: "plan_rejected",
        reason: "You have a clarification session already in progress for \"" + pending.description + "\". Answer the current question, or reply \"cancel\" to abandon it and start something new."
      });
    }

    const isConfirmation = confirmPattern.test(trimmedPrompt);

    if (phase === "summary") {
      if (!isConfirmation) {
        const revisedDescription = getEnrichedDescription() + "\n\nRevision from the user:\n" + trimmedPrompt;
        setEnrichedDescription(revisedDescription);
        return res.json({
          success: true,
          action: "requirements_summary",
          summary: revisedDescription,
          message: "Updated. Does this accurately capture your requirements? Reply \"approve\" to continue, or tell me what to add or change (for example: \"also add a mobile app\" or \"remove the tagging feature\")."
        });
      }

      const enrichedDescription = getEnrichedDescription();
      const relevantFiles = searchIndex(enrichedDescription, 5);

      if (!relevantFiles || relevantFiles.length === 0) {
        try {
          const rawBlueprint = await generateBlueprint(enrichedDescription);
          const cleanedBlueprint = stripCodeFences(rawBlueprint);
          const blueprint = lenientJsonParse(cleanedBlueprint);
          beginBlueprintConfirmation({ blueprint });
          return res.json({
            success: true,
            action: "architecture_blueprint",
            blueprint,
            message: "Here's the proposed architecture. Reply \"looks good\" to proceed, or tell me specifically what to change (for example: \"use PostgreSQL instead of MongoDB\")."
          });
        } catch (err) {
          console.error("Blueprint generation failed, proceeding without it:", err.message);
          clearClarification();
          return generateAndReturnPlan(enrichedDescription, res);
        }
      }

      beginArchitectureConfirmation({ relevantFiles });
      return res.json({
        success: true,
        action: "architecture_context_check",
        relevantFiles: relevantFiles.map((f) => f.path),
        message: "These existing files look relevant to this task. Reply with something like \"looks good\" to proceed, or describe what's missing or incorrect."
      });
    }

    if (phase === "architecture") {
      let finalDescription = getEnrichedDescription();
      if (!isConfirmation) {
        finalDescription = finalDescription + "\n\nCorrection from the user about the existing repository structure (this overrides anything assumed above about which files already exist or where they live):\n" + trimmedPrompt;
        setEnrichedDescription(finalDescription);
      }

      try {
        const rawBlueprint = await generateBlueprint(finalDescription);
        const cleanedBlueprint = stripCodeFences(rawBlueprint);
        const blueprint = lenientJsonParse(cleanedBlueprint);
        beginBlueprintConfirmation({ blueprint });
        return res.json({
          success: true,
          action: "architecture_blueprint",
          blueprint,
          message: "Here's the proposed architecture. Reply \"looks good\" to proceed, or tell me specifically what to change (for example: \"use PostgreSQL instead of MongoDB\")."
        });
      } catch (err) {
        console.error("Blueprint generation failed, proceeding without it:", err.message);
        clearClarification();
        return generateAndReturnPlan(finalDescription, res);
      }
    }
    if (phase === "blueprint") {
      if (!isConfirmation) {
        const correctedDescription = getEnrichedDescription() + "\n\nCorrection from the user about the architecture:\n" + trimmedPrompt;
        setEnrichedDescription(correctedDescription);

        try {
          const rawBlueprint = await generateBlueprint(correctedDescription);
          const cleanedBlueprint = stripCodeFences(rawBlueprint);
          const blueprint = lenientJsonParse(cleanedBlueprint);
          beginBlueprintConfirmation({ blueprint });
          return res.json({
            success: true,
            action: "architecture_blueprint",
            blueprint,
            message: "Updated. Here's the revised architecture. Reply \"looks good\" to proceed, or tell me specifically what to change (for example: \"use PostgreSQL instead of MongoDB\")."
          });
        } catch (err) {
          console.error("Blueprint regeneration failed, proceeding without further revision:", err.message);
          clearClarification();
          return generateAndReturnPlan(correctedDescription, res);
        }
      }

      const enrichedDescription = getEnrichedDescription();
      const blueprint = getBlueprint();
      const finalDescription = enrichedDescription + "\n\nAgreed architecture (technology choices below are binding, not suggestions):\n" + JSON.stringify(blueprint);

      clearClarification();
      return generateAndReturnPlan(finalDescription, res, blueprint);
    }



    const skipPattern = /best judgment|you decide|not sure|don'?t know|^skip$|up to you|whatever you think|your call/i;
    const skipped = skipPattern.test(trimmedPrompt);

    recordAnswer({ answer: trimmedPrompt, skipped });

    if (isComplete()) {
      const summary = buildRequirementsSummary();
      const pending = getPendingClarification();
      setEnrichedDescription(pending.description + "\n\nRequirements summary:\n" + summary);
      setPhase("summary");

      return res.json({
        success: true,
        action: "requirements_summary",
        summary,
        message: "Does this accurately capture your requirements? Reply \"approve\" to continue, or tell me what to add or change (for example: \"also add a mobile app\" or \"remove the tagging feature\")."
      });
    }

    const clarification = getPendingClarification();
    return res.json({
      success: true,
      action: "clarification_question",
      question: getCurrentQuestion(),
      questionNumber: clarification.currentIndex + 1,
      totalQuestions: clarification.questions.length
    });
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

  const documentCommand = parseDocumentCommand(prompt);
  if (documentCommand.isDocumentCommand) {
    return handleDocumentCommand(res);
  }

  const testCommand = parseTestCommand(prompt);
  if (testCommand.isTestCommand) {
    return handleRunTestsCommand(res);
  }

  const gitCommand = parseGitCommand(prompt);
  if (gitCommand.type === "status") {
    return handleGitStatusCommand(res);
  }
  if (gitCommand.type === "diff") {
    return handleGitDiffCommand(res);
  }
  if (gitCommand.type === "commit") {
    return handleGitCommitCommand(res);
  }

  const installCommand = parseInstallCommand(prompt);
  if (installCommand.isInstallCommand) {
    return handleInstallCommand(installCommand, res);
  }

  const testGenCommand = parseTestGenerationCommand(prompt);
  if (testGenCommand.isTestGenerationCommand) {
    return handleWriteTestsCommand(testGenCommand.targetPath, res);
  }

  const executePlanCommand = parseExecutePlanCommand(prompt);
  if (executePlanCommand.isExecutePlanCommand) {
    return handleExecutePlanCommand(executePlanCommand, res);
  }

  const planCommand = parsePlanCommand(prompt);
  if (planCommand.isPlanCommand) {
    return handlePlanCommand(planCommand, res);
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

app.post("/api/write", requireAuth, (req, res) => {
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

app.get("/api/plan/current", requireAuth, (req, res) => {
  const plan = getPendingPlan();
  if (!plan) {
    return res.json({ success: false, reason: "No pending plan" });
  }
  return res.json({ success: true, plan });
});

app.post("/api/plan/reject", requireAuth, (req, res) => {
  const { planId } = req.body;

  if (!isValidPlanId(planId)) {
    return res.status(400).json({ success: false, reason: "No matching pending plan to reject." });
  }

  clearPlan();

  let campaignCleared = false;
  if (hasActiveCampaign()) {
    clearCampaign();
    campaignCleared = true;
  }

  return res.json({ success: true, action: "plan_cleared", campaignCleared });
});

app.post("/api/plan/approve", requireAuth, async (req, res) => {
  const { planId } = req.body;

  if (!isValidPlanId(planId)) {
    return res.status(400).json({ success: false, reason: "No matching pending plan to approve." });
  }

  const plan = getPendingPlan();

  if (plan.stage !== "plan_proposed") {
    return res.status(400).json({
      success: false,
      reason: "Plan is not in the proposal stage. Current stage: " + plan.stage
    });
  }

  try {
    const enrichedFiles = [];

    // Precompute the resolved path of every file in this batch, so
    // sibling files being created together (e.g. a new source file and
    // its test) don't falsely fail import checking just because
    // neither has been written to disk yet — the whole batch is one
    // unit of work, not written until the human approves and applies it.
    const batchSiblingPaths = plan.files
      .map((f) => isPathSafe(f.path))
      .filter((check) => check.safe)
      .map((check) => check.resolvedPath);

    for (const file of plan.files) {
      const safetyCheck = isPathSafe(file.path);

      if (!safetyCheck.safe) {
        return res.status(400).json({
          success: false,
          action: "plan_rejected",
          reason: "Path safety check failed for " + file.path + ": " + safetyCheck.reason
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

      const rawGenerated = await generateFileContent({
        mode: fileExists ? "edit" : "write",
        targetPath: file.path,
        instruction: file.description,
        projectContext: plan.description,
        existingContent: fileExists ? existingContent : null
      });

      const cleanedContent = stripCodeFences(rawGenerated);
    const { checkSyntax } = require("./syntaxChecker");
    const syntaxResult = checkSyntax(cleanedContent);
    const { checkImports } = require("./importChecker");
    const importResult = checkImports(cleanedContent, safetyCheck.resolvedPath, batchSiblingPaths);
    const { checkLint } = require("./lintChecker");
    const lintResult = checkLint(cleanedContent);
    const { runTestsAgainstProposal } = require("./testRunner");
    const testCheck = runTestsAgainstProposal(safetyCheck.resolvedPath, cleanedContent);
    // Note: unlike the single-file routes, this does not hard-refuse on
    // failure -- it surfaces the real test result so a human reviewing
    // the batch diff can see it, without risking disruption to the
    // multi-file campaign loop's control flow.

      enrichedFiles.push({
        path: file.path,
        description: file.description,
        before: fileExists ? existingContent : "",
        after: cleanedContent,
      syntaxCheck: syntaxResult,
      importCheck: importResult,
      lintCheck: lintResult,
      testCheck,
        mode: fileExists ? "edit" : "write"
      });
    }

    const enrichResult = enrichWithDiffs(planId, enrichedFiles);

    if (!enrichResult.success) {
      return res.status(400).json({ success: false, reason: enrichResult.reason });
    }

    return res.json({
      success: true,
      action: "diffs_proposed",
      planId,
      files: enrichedFiles
    });
  } catch (err) {
    console.error("Plan approval failed:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Extracts the agreed architecture from a plan's description (if one
// exists — a plan created via execute plan: won't have one) and saves
// it to persistent project memory, so future plan: requests for the
// same project can skip re-asking about tech stack, platform, and
// security that's already established, instead of treating every
// incremental feature as a brand-new project from scratch.
function saveArchitectureToMemory(description) {
  const match = description.match(/Agreed architecture \(technology choices below are binding, not suggestions\):\s*(\{[\s\S]*\})/);
  if (!match) return;

  try {
    const blueprint = lenientJsonParse(match[1]);
    const fact = `Established project architecture: ${blueprint.frontend} frontend, ${blueprint.backend} backend, ${blueprint.database} database, ${blueprint.authentication} authentication.`;
    addFact(fact);
  } catch (err) {
    console.error("Could not save architecture to project memory:", err.message);
  }
}

app.post("/api/plan/apply", requireAuth, async (req, res) => {
  const { planId } = req.body;

  if (!isValidPlanId(planId)) {
    return res.status(400).json({ success: false, reason: "No matching pending plan to apply." });
  }

  const plan = getPendingPlan();

  if (plan.stage !== "diffs_proposed") {
    return res.status(400).json({
      success: false,
      reason: "Plan diffs have not been approved yet. Current stage: " + plan.stage
    });
  }

  const results = [];

  for (const file of plan.files) {
    const safetyCheck = isPathSafe(file.path);

    if (!safetyCheck.safe) {
      return res.status(400).json({
        success: false,
        action: "apply_halted",
        reason: "Path safety check failed for " + file.path + ": " + safetyCheck.reason,
        filesWritten: results
      });
    }

    try {
      const backupPath = backupExistingFile(safetyCheck.resolvedPath, file.path);
      fs.mkdirSync(path.dirname(safetyCheck.resolvedPath), { recursive: true });
      fs.writeFileSync(safetyCheck.resolvedPath, file.after, "utf-8");

      console.log("[api/plan/apply] Wrote " + file.after.length + " bytes to " + file.path);

      results.push({
        path: file.path,
        bytesWritten: file.after.length,
        backupCreated: backupPath !== null
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        action: "apply_halted",
        reason: "Write failed for " + file.path + ": " + err.message,
        filesWritten: results
      });
    }
  }

  const appliedPaths = results.map((r) => r.path);
  clearPlan();
  saveArchitectureToMemory(plan.description);

  if (!hasActiveCampaign()) {
    return res.json({
      success: true,
      action: "plan_applied",
      filesWritten: results
    });
  }

  const campaignBefore = getActiveCampaign();
  recordBatchCompletion(campaignBefore.id, appliedPaths);

  try {
    syncReindexWorkspace();

    const MAX_PLAN_FILES = 5;
    const campaign = getActiveCampaign();
    const { files: nextFiles, remainingCount } = takeNextBatch(campaign.id, MAX_PLAN_FILES);

    if (!Array.isArray(nextFiles) || nextFiles.length === 0) {
      const finishedCampaign = campaign;
      clearCampaign();
      return res.json({
        success: true,
        action: "plan_applied",
        filesWritten: results,
        campaignComplete: true,
        totalBatches: finishedCampaign.batchNumber - 1
      });
    }

    const nextPlan = createPlan({ description: campaign.description, files: nextFiles });

    return res.json({
      success: true,
      action: "plan_applied",
      filesWritten: results,
      nextBatch: {
        planId: nextPlan.id,
        batchNumber: campaign.batchNumber,
        description: nextPlan.description,
        files: nextPlan.files,
        remainingAfterThisBatch: remainingCount
      }
    });
  } catch (err) {
    console.error("Batch continuation failed:", err.message);
    clearCampaign();
    return res.json({
      success: true,
      action: "plan_applied",
      filesWritten: results,
      campaignError: "Could not continue to the next batch automatically: " + err.message
    });
  }
});

app.get("/api/files", requireAuth, (req, res) => {
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
