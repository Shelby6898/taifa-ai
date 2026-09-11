require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { getSessionKey } = require("./sessionKey");
const {
  getWorkspaceDir,
  ensureWorkspace,
  listProjectsForStudent
} = require("./workspaceResolver");
const { backupExistingFile } = require("./backupManager");
const { searchIndex, buildIndex, formatFullIndex } = require("./fileIndexer");
const { parseWriteCommand } = require("./writeCommandParser");
const { isPathSafe } = require("./pathSafety");
const { generateFileContent, generateFix, generateDocumentation, generatePlan, generateSelfReview, generateTestFile, generateClarifyingQuestions, generateBlueprint , generateDescriptionFix, generateTargetedAddition } = require("./generateFileContent");
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
const { hasPendingWrite, getPendingWrite, createPendingWrite, clearPendingWrite } = require("./pendingWriteState");
const { loadHistory, appendUserTurn, appendAssistantTurn } = require("./conversationHistory");
const { runTests } = require("./testRunner");
const { buildTree } = require("./fileTree");
const { parseRememberCommand } = require("./rememberCommandParser");
const { parsePlanCommand } = require("./planCommandParser");
const { hasPendingPlan, createPlan, getPendingPlan, enrichWithDiffs, clearPlan, isValidPlanId, hasActiveCampaign, getActiveCampaign, startCampaign, recordBatchCompletion, takeNextBatch, clearCampaign, MAX_PLAN_FILES } = require("./planState");
const { checkVocabularyConsistency, checkExcludedScope, checkMissingRequiredScope } = require("./planValidator");
const { hasPendingClarification, getPhase, startClarification, recordAnswer, isComplete, getCurrentQuestion, getPendingClarification, buildRequirementsSummary, setPhase, setEnrichedDescription, getEnrichedDescription, beginArchitectureConfirmation, getRelevantFiles, beginBlueprintConfirmation, getBlueprint, clearClarification } = require("./clarificationState");
const { FIXED_PLANNING_QUESTIONS, SHORT_PLANNING_QUESTIONS } = require("./planningQuestions");
const { addFact, formatMemoryBlock } = require("./projectMemory");
const authRoutes = require("./authRoutes");
const { requireAuth } = require("./authMiddleware");
const { deleteProject } = require("./projectDeletion");

const app = express();

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL_NAME = "qwen2.5-coder-6k";

function syncReindexWorkspace(sessionKey) {
  buildIndex(sessionKey);
  const { buildImportGraph } = require("./importGraphBuilder");
  buildImportGraph(sessionKey);
  const { buildFunctionIndex } = require("./functionIndexBuilder");
  buildFunctionIndex(sessionKey);
  const { buildComponentGraph } = require("./componentGraphBuilder");
  buildComponentGraph(sessionKey);
  const { buildDbSchemaGraph } = require("./dbSchemaBuilder");
  buildDbSchemaGraph(sessionKey);
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

// The model occasionally echoes the field labels it was given back into
// the content itself, producing "Path: <path>\nDescription: <real text>"
// instead of just the real text. Strips that redundant echo when present,
// leaving the description untouched otherwise. Deterministic, no model call.
function cleanDescription(description) {
  if (typeof description !== "string") return description;
  const match = description.match(/^Path:\s*.*?\n\s*Description:\s*(.*)$/is);
  return match ? match[1].trim() : description;
}

async function generateBatchPlan({ description, completedFiles, blueprint }, sessionKey) {
  const fullIndex = formatFullIndex(sessionKey, description);
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
  }).map((f) => ({ ...f, description: cleanDescription(f.description) }));

  // annotateStorageFiles previously stapled a "(uses X, per agreed
  // architecture)" text suffix onto file descriptions here — cosmetic
  // tagging with no real content check (confirmed via live evidence).
  // checkVocabularyConsistency in planValidator.js now does the real
  // check, against the plan's actual descriptions, so this call was
  // removed as redundant/dead weight.
  return { files: dedupedFiles };
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
  const sessionKey = getSessionKey(req);
  try {
    const index = buildIndex(sessionKey);
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

// A lightweight, model-facing summary of a response — feeds buildFullPrompt's
// conversation-history block. Deliberately does NOT try to match the exact
// wording the frontend shows the student; that's a separate job handled by
// the frontend's own formatter reading the same raw `data` payload.
function summarizeForModel(payload) {
  if (payload.message) return payload.message;
  if (payload.question) return payload.question;
  if (payload.reason) return payload.reason;
  if (payload.summary) return payload.summary;
  return payload.action || "";
}

// Wraps res.json for every response inside the /api/chat handler chain so
// each turn is persisted to server-side conversation history automatically,
// without needing a manual appendAssistantTurn call at every response site.
function sendChatResponse(res, sessionKey, payload) {
  appendAssistantTurn(sessionKey, {
    action: payload.action,
    data: payload,
    content: summarizeForModel(payload)
  });
  return res.json(payload);
}

function buildFullPrompt(userPrompt, history, sessionKey) {
  const memoryBlock = formatMemoryBlock(sessionKey);
  const historyBlock = formatHistory(history);
  const matches = searchIndex(sessionKey, userPrompt, 3);
  let contextBlock = "";
  if (matches.length > 0) {
    const contextBlocks = matches
      .map((file) => `--- ${file.path} ---\n${file.snippet}`)
      .join("\n\n");
    contextBlock = `Context from project files:\n\n${contextBlocks}\n\n`;
  }
  return `${memoryBlock}${historyBlock}${contextBlock}User question: ${userPrompt}`;
}

async function handleWriteCommand(parsedCommand, res, sessionKey) {
  if (parsedCommand.malformed) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: "Command format is incomplete. Use: write to: path.js | instruction"
    });
  }

  const { mode, targetPath, instruction } = parsedCommand;

  const safetyCheck = isPathSafe(sessionKey, targetPath);

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

  // Build sibling-file and project-context grounding, the same mechanism
  // the multi-file plan/approve path already uses (see enrichedFiles-based
  // siblingFiles construction there) -- but sourced from files already on
  // disk, since a single write:/edit: call has no "rest of the batch" to
  // draw from. Missing this was the root cause of repeated Mongoose-style
  // drift and generic-CRUD-template fallbacks on this path: the prompt
  // template already supports both fields and even has an explicit
  // anti-Mongoose-drift warning gated on projectContext being present, but
  // this path never populated either, so none of it ever activated.
  const { getWorkspaceDir: getWorkspaceDirForContext } = require("./workspaceResolver");
  let siblingFiles = {};
  let projectContext = null;
  try {
    const workspaceDir = getWorkspaceDirForContext(sessionKey);

    const pkgPath = path.join(workspaceDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      if (deps.length > 0) {
        const ormNote = deps.includes("sequelize")
          ? " This project uses Sequelize with PostgreSQL -- NOT Mongoose/MongoDB."
          : deps.includes("mongoose")
          ? " This project uses Mongoose with MongoDB."
          : "";
        projectContext = `This project's package.json declares these dependencies: ${deps.join(", ")}.${ormNote}`;
      }
    }

    const stemOf = (p) => p.split("/").pop().replace(/\.[jt]sx?$/i, "").replace(/(Routes|Model|Controller|Service)$/i, "").toLowerCase();
    const isModelFile = (p) => /\/models\//i.test(p) || /Model\.[jt]sx?$/i.test(p);
    const targetStem = stemOf(targetPath);
    const targetIsModel = isModelFile(targetPath);

    const candidateDirs = ["backend/models", "backend/routes"];
    for (const dir of candidateDirs) {
      const fullDir = path.join(workspaceDir, dir);
      if (!fs.existsSync(fullDir)) continue;
      const filenames = fs.readdirSync(fullDir).filter((f) => /\.[jt]sx?$/i.test(f));
      for (const f of filenames) {
        const relPath = dir + "/" + f;
        if (relPath === targetPath) continue;
        const efStem = stemOf(relPath);
        const mentioned = instruction && (instruction.includes(f) || instruction.toLowerCase().includes(efStem));
        const bothModels = targetIsModel && isModelFile(relPath);
        if (efStem === targetStem || mentioned || bothModels) {
          siblingFiles[relPath] = fs.readFileSync(path.join(fullDir, f), "utf-8");
        }
      }
    }
  } catch (err) {
    console.error("generateFileContent context: could not build sibling/project context:", err.message);
  }

  // No-op edit detection: if this is an edit: on an existing file, and the
  // instruction's literal text already contains what amounts to the
  // existing file's content (whitespace-normalized), the human is asking
  // for a "change" that changes nothing. Confirmed live that this specific
  // instruction shape ("replace the entire file with exactly this
  // content...<content identical to what's on disk>") consistently
  // produced degenerate model output (raw output of just ">>>>>>>
  // REPLACE" with no actual SEARCH/REPLACE blocks) across all retry
  // attempts -- not random non-determinism, a genuine confusion the local
  // model has with being asked to "change" something into itself. Skip
  // generation entirely in this case rather than burning 3 retry attempts
  // on a call that reliably fails.
  if (mode === "edit" && fileExists && instruction) {
    const normalize = (s) => s.replace(/\s+/g, " ").trim();
    const normalizedExisting = normalize(existingContent);
    const normalizedInstruction = normalize(instruction);
    if (normalizedExisting.length > 20 && normalizedInstruction.includes(normalizedExisting)) {
      return res.json({
        success: true,
        action: "generation_skipped",
        reason: "The instruction's target content is already identical to the current file — no change needed.",
        targetPath
      });
    }
  }

  // Retry loop: local-model generation has shown real run-to-run
  // non-determinism -- the SAME prompt/context can pass or fail validation
  // on different calls (confirmed live: an identical "replace with exactly
  // this" instruction was refused three times in a row, then succeeded
  // cleanly on a fourth attempt with byte-identical input). Rather than
  // surfacing a refusal to the user on the very first failed attempt,
  // retry automatically up to MAX_GENERATION_ATTEMPTS times before giving
  // up -- only the LAST attempt's refusal (if all attempts fail) is ever
  // shown to the user.
  const MAX_GENERATION_ATTEMPTS = 3;
  let lastRefusal = null;

  for (let attemptNum = 1; attemptNum <= MAX_GENERATION_ATTEMPTS; attemptNum++) {
    const isLastAttempt = attemptNum === MAX_GENERATION_ATTEMPTS;

    try {
      const { content: cleanedContent, patchWarnings } = await generateFileContent({
        mode,
        targetPath,
        instruction,
        projectContext,
        siblingFiles,
        existingContent: fileExists ? existingContent : null
      });

      const { checkSyntax } = require("./syntaxChecker");
      const syntaxResult = checkSyntax(cleanedContent);
      const { checkImports } = require("./importChecker");
      const importResult = checkImports(sessionKey, cleanedContent, safetyCheck.resolvedPath);
      const { checkLint } = require("./lintChecker");
      const lintResult = checkLint(cleanedContent);
      const { runTestsAgainstProposal } = require("./testRunner");
      const testCheck = runTestsAgainstProposal(safetyCheck.resolvedPath, cleanedContent);

      if (testCheck.hasTests && !testCheck.passed) {
        lastRefusal = {
          success: true,
          action: "generation_refused",
          reason: "The existing test suite fails against this proposed change.",
          testCheck,
          syntaxCheck: syntaxResult,
          importCheck: importResult
        };
        if (isLastAttempt) return res.json(lastRefusal);
        console.log(`[handleWriteCommand] attempt ${attemptNum} refused (test suite), retrying...`);
        continue;
      }

      const { detectRouteRegressions } = require("./regressionChecker");
      const regressionWarnings = detectRouteRegressions(fileExists ? existingContent : null, cleanedContent);

      if (regressionWarnings.length > 0) {
        lastRefusal = {
          success: true,
          action: "generation_refused",
          reason: "This change appears to silently remove or weaken an existing route.",
          regressionWarnings,
          syntaxCheck: syntaxResult,
          importCheck: importResult,
          testCheck
        };
        if (isLastAttempt) return res.json(lastRefusal);
        console.log(`[handleWriteCommand] attempt ${attemptNum} refused (regression), retrying...`);
        continue;
      }

      const { checkUndeclaredDependencies, checkPackageVersionsExist } = require("./packageJsonChecker");
      const undeclaredDependencies = checkUndeclaredDependencies(safetyCheck.resolvedPath, cleanedContent);

      if (undeclaredDependencies.length > 0) {
        lastRefusal = {
          success: true,
          action: "generation_refused",
          reason: "This change requires a package that isn't declared in package.json: " + undeclaredDependencies.join(", "),
          undeclaredDependencies,
          syntaxCheck: syntaxResult,
          importCheck: importResult,
          testCheck
        };
        if (isLastAttempt) return res.json(lastRefusal);
        console.log(`[handleWriteCommand] attempt ${attemptNum} refused (undeclared deps), retrying...`);
        continue;
      }

      let packageVersionCheck = null;
      if (safetyCheck.resolvedPath.endsWith("package.json")) {
        packageVersionCheck = await checkPackageVersionsExist(cleanedContent);
        if (packageVersionCheck.invalidVersions && packageVersionCheck.invalidVersions.length > 0) {
          lastRefusal = {
            success: true,
            action: "generation_refused",
            reason: "This package.json specifies a version that doesn't exist on the npm registry: " +
              packageVersionCheck.invalidVersions.map(v => `${v.name}@${v.exactVersion}`).join(", "),
            packageVersionCheck,
            syntaxCheck: syntaxResult,
            importCheck: importResult,
            testCheck
          };
          if (isLastAttempt) return res.json(lastRefusal);
          console.log(`[handleWriteCommand] attempt ${attemptNum} refused (package version), retrying...`);
          continue;
        }
      }

      // The multi-file plan/approve path already runs validateGeneratedCode
      // (ORM-mismatch, undefined-association, response-field-mismatch checks),
      // but single-file write/edit commands never did -- meaning every
      // Mongoose-vs-Sequelize, undefined-association, or response-shape bug
      // caught by those checks was invisible on this path. Infer the SQL/ORM
      // architecture from package.json (ground truth for what's actually
      // installed) rather than a stored memory fact, since a project may
      // never have gone through plan:/execute plan: and so never had one
      // written at all.
      const { validateGeneratedCode } = require("./codeValidator");
      const { getWorkspaceDir } = require("./workspaceResolver");
      let batchBlueprint = null;
      try {
        const workspaceDir = getWorkspaceDir(sessionKey);
        const pkgPath = path.join(workspaceDir, "package.json");
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.sequelize) batchBlueprint = { database: "PostgreSQL" };
        }
      } catch (err) {
        console.error("codeValidator: could not infer architecture from package.json:", err.message);
      }

      let alreadyAppliedModelFiles = [];
      try {
        const workspaceDir = getWorkspaceDir(sessionKey);
        const modelsDir = path.join(workspaceDir, "backend", "models");
        if (fs.existsSync(modelsDir)) {
          const modelFilenames = fs.readdirSync(modelsDir).filter((f) => /\.[jt]sx?$/i.test(f));
          alreadyAppliedModelFiles = modelFilenames
            .filter((f) => !safetyCheck.resolvedPath.endsWith("models/" + f))
            .map((f) => ({
              path: "backend/models/" + f,
              after: fs.readFileSync(path.join(modelsDir, f), "utf-8")
            }));
        }
      } catch (err) {
        console.error("codeValidator: could not read already-applied model files:", err.message);
      }

      if (batchBlueprint) {
        const currentFile = { path: targetPath, after: cleanedContent };
        const codeValidationIssues = validateGeneratedCode(
          [currentFile, ...alreadyAppliedModelFiles],
          batchBlueprint
        ).filter((issue) => issue.path === targetPath);

        if (codeValidationIssues.length > 0) {
          lastRefusal = {
            success: true,
            action: "generation_refused",
            reason: "The code validator found issue(s) that indicate this change will not work correctly.",
            codeValidationIssues,
            syntaxCheck: syntaxResult,
            importCheck: importResult,
            testCheck
          };
          if (isLastAttempt) return res.json(lastRefusal);
          console.log(`[handleWriteCommand] attempt ${attemptNum} refused (code validator: ${codeValidationIssues.map(i => i.type).join(", ")}), retrying...`);
          continue;
        }
      }

      createPendingWrite(sessionKey, {
        mode,
        targetPath,
        resolvedPath: safetyCheck.resolvedPath,
        fileExists,
        before: fileExists ? existingContent : "",
        after: cleanedContent,
        patchWarnings,
        syntaxCheck: syntaxResult,
        importCheck: importResult,
        lintCheck: lintResult,
        testCheck
      });

      return res.json({
        success: true,
        action: "propose_write",
        mode,
        targetPath,
        resolvedPath: safetyCheck.resolvedPath,
        fileExists,
        before: fileExists ? existingContent : "",
        after: cleanedContent,
        patchWarnings,
        syntaxCheck: syntaxResult,
        importCheck: importResult,
        lintCheck: lintResult,
        testCheck,
      });
    } catch (err) {
      // "Scoped edit failed: ..." errors come from applyScopedEdit when the
      // model's raw output couldn't be parsed into valid SEARCH/REPLACE
      // blocks (or none of the parsed blocks matched the existing file) --
      // this is the same class of local-model non-determinism the retry
      // loop above already handles for validator refusals, just surfaced
      // as a thrown error instead of a returned issues array. Retry it the
      // same way. A genuinely different error (Ollama unreachable, a
      // required module missing, etc.) will have a different message and
      // still fails immediately below.
      const isRetryableParseFailure = typeof err.message === "string" && err.message.startsWith("Scoped edit failed:");

      if (isRetryableParseFailure && !isLastAttempt) {
        console.log(`[handleWriteCommand] attempt ${attemptNum} failed (${err.message}), retrying...`);
        continue;
      }

      console.error("Content generation failed:", err.message);
      return res.status(500).json({
        success: false,
        action: "generation_failed",
        reason: err.message
      });
    }
  }
}

async function handleWriteTestsCommand(targetPath, res, sessionKey) {
  const sourceSafetyCheck = isPathSafe(sessionKey, targetPath);

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
  const testSafetyCheck = isPathSafe(sessionKey, testFilePath);

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
    const requiredModuleSystem = getModuleSystemForPath(sessionKey, testSafetyCheck.resolvedPath);

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
    const importResult = checkImports(sessionKey, cleanedContent, testSafetyCheck.resolvedPath);

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

    const { checkUndeclaredDependencies } = require("./packageJsonChecker");
    const undeclaredDependencies = checkUndeclaredDependencies(testSafetyCheck.resolvedPath, cleanedContent);

    if (undeclaredDependencies.length > 0) {
      return res.json({
        success: true,
        action: "test_generation_refused",
        message: "The generated test requires a package that isn't declared in package.json: " + undeclaredDependencies.join(", "),
        undeclaredDependencies,
        syntaxCheck: syntaxResult,
        importCheck: importResult,
        testCheck
      });
    }

    createPendingWrite(sessionKey, {
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

async function handleFixCommand(fixCommand, res, sessionKey) {
  if (fixCommand.malformed) {
    return res.status(400).json({
      success: false,
      action: "fix_rejected",
      reason: "No error text provided. Use: fix this: <paste your error or stack trace>"
    });
  }

  const { errorText } = fixCommand;
  const workspaceDir = getWorkspaceDir(sessionKey);

  let relativePath = findWorkspaceRelativePath(errorText, workspaceDir);
  let locationMethod = "stack_trace";

  if (!relativePath) {
    const matches = searchIndex(sessionKey, errorText, 1, [".md"]);
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

  const safetyCheck = isPathSafe(sessionKey, relativePath);
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
    const { content: cleanedContent, patchWarnings } = await generateFix({
      targetPath: relativePath,
      errorText,
      existingContent
    });

    const { checkSyntax } = require("./syntaxChecker");
    const syntaxResult = checkSyntax(cleanedContent);
    const { checkImports } = require("./importChecker");
    const importResult = checkImports(sessionKey, cleanedContent, safetyCheck.resolvedPath);
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

    const { detectRouteRegressions } = require("./regressionChecker");
    const regressionWarnings = detectRouteRegressions(existingContent, cleanedContent);

    if (regressionWarnings.length > 0) {
      return res.json({
        success: true,
        action: "generation_refused",
        reason: "This fix appears to silently remove or weaken an existing route.",
        regressionWarnings,
        syntaxCheck: syntaxResult,
        importCheck: importResult,
        testCheck
      });
    }

    const { checkUndeclaredDependencies, checkPackageVersionsExist } = require("./packageJsonChecker");
    const undeclaredDependencies = checkUndeclaredDependencies(safetyCheck.resolvedPath, cleanedContent);

    if (undeclaredDependencies.length > 0) {
      return res.json({
        success: true,
        action: "generation_refused",
        reason: "This fix requires a package that isn't declared in package.json: " + undeclaredDependencies.join(", "),
        undeclaredDependencies,
        syntaxCheck: syntaxResult,
        importCheck: importResult,
        testCheck
      });
    }

    let packageVersionCheck = null;
    if (safetyCheck.resolvedPath.endsWith("package.json")) {
      packageVersionCheck = await checkPackageVersionsExist(cleanedContent);
      if (packageVersionCheck.invalidVersions && packageVersionCheck.invalidVersions.length > 0) {
        return res.json({
          success: true,
          action: "generation_refused",
          reason: "This package.json specifies a version that doesn't exist on the npm registry: " +
            packageVersionCheck.invalidVersions.map(v => `${v.name}@${v.exactVersion}`).join(", "),
          packageVersionCheck,
          syntaxCheck: syntaxResult,
          importCheck: importResult,
          testCheck
        });
      }
    }

    createPendingWrite(sessionKey, {
      mode: "edit",
      targetPath: relativePath,
      resolvedPath: safetyCheck.resolvedPath,
      fileExists: true,
      before: existingContent,
      after: cleanedContent,
      patchWarnings,
      syntaxCheck: syntaxResult,
      importCheck: importResult,
      lintCheck: lintResult,
      testCheck,
      locationMethod
    });

    return res.json({
      success: true,
      action: "propose_write",
      mode: "edit",
      targetPath: relativePath,
      resolvedPath: safetyCheck.resolvedPath,
      fileExists: true,
      before: existingContent,
      after: cleanedContent,
      patchWarnings,
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

async function handleDocumentCommand(res, sessionKey) {
  const fullIndex = formatFullIndex(sessionKey);

  if (!fullIndex) {
    return res.json({
      success: false,
      action: "fix_not_located",
      reason: "No files found in workspace to document."
    });
  }

  const targetPath = "README.md";
  const safetyCheck = isPathSafe(sessionKey, targetPath);

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

    createPendingWrite(sessionKey, {
      mode: fileExists ? "edit" : "write",
      targetPath,
      resolvedPath: safetyCheck.resolvedPath,
      fileExists,
      before: fileExists ? existingContent : "",
      after: cleanedContent,
      isDocumentation: true
    });

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

async function handleRunTestsCommand(res, sessionKey) {
  try {
    const result = await runTests(sessionKey);

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

async function handleGitStatusCommand(res, sessionKey) {
  const result = await getStatus(sessionKey);

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

async function handleGitDiffCommand(res, sessionKey) {
  const result = await getDiff(sessionKey);

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

async function handleGitCommitCommand(res, sessionKey) {
  if (!isGitRepo(sessionKey)) {
    return res.json({ success: true, action: "git_not_repo", message: "The workspace is not a git repository." });
  }

  if (hasPendingAction(sessionKey)) {
    return res.status(409).json({
      success: false,
      action: "action_rejected",
      reason: "Another action is already pending approval. Approve or reject it first."
    });
  }

  const diffResult = await getDiff(sessionKey);
  const diffText = diffResult.stdout || "";

  if (!diffText.trim()) {
    return res.json({ success: true, action: "git_nothing_to_commit", message: "No uncommitted changes found." });
  }

  const statusResult = await getStatus(sessionKey);
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

    const action = createPendingAction(sessionKey, {
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

async function handleInstallCommand(installCommand, res, sessionKey) {
  if (hasPendingAction(sessionKey)) {
    return res.status(409).json({
      success: false,
      action: "action_rejected",
      reason: "Another action is already pending approval. Approve or reject it first."
    });
  }

  const action = createPendingAction(sessionKey, {
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
  const sessionKey = getSessionKey(req);
  const { actionId } = req.body;

  if (!isValidActionId(sessionKey, actionId)) {
    return res.status(400).json({ success: false, reason: "No matching pending action to approve." });
  }

  const action = getPendingAction(sessionKey);

  try {
    if (action.type === "git_commit") {
      const result = await commitChanges(sessionKey, action.payload.message);
      clearPendingAction(sessionKey);

      if (!result.success) {
        return res.json({ success: true, action: "commit_failed", reason: result.reason });
      }

      return res.json({ success: true, action: "commit_applied", stdout: result.stdout });
    }

    if (action.type === "install") {
      const result = await installPackage(sessionKey, action.payload.packageName);
      clearPendingAction(sessionKey);

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

    clearPendingAction(sessionKey);
    return res.status(400).json({ success: false, reason: "Unknown pending action type." });
  } catch (err) {
    clearPendingAction(sessionKey);
    console.error("Tool action execution failed:", err.message);
    return res.status(500).json({ success: false, reason: err.message });
  }
});

app.post("/api/tool-action/reject", requireAuth, (req, res) => {
  const sessionKey = getSessionKey(req);
  const { actionId } = req.body;

  if (!isValidActionId(sessionKey, actionId)) {
    return res.status(400).json({ success: false, reason: "No matching pending action to reject." });
  }

  clearPendingAction(sessionKey);
  return res.json({ success: true, action: "action_cleared" });
});

async function handlePlanCommand(planCommand, res, sessionKey) {
  if (planCommand.malformed) {
    return res.status(400).json({
      success: false,
      action: "plan_rejected",
      reason: "No description provided. Use: plan: <description of what you want built>"
    });
  }

  if (hasPendingPlan(sessionKey)) {
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A plan is already pending review. Approve or reject it before starting a new one."
    });
  }

  if (hasActiveCampaign(sessionKey)) {
    const campaign = getActiveCampaign(sessionKey);
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A multi-batch task is already in progress (batch " + campaign.batchNumber + "). Approve or reject the current batch before starting something new."
    });
  }

  if (hasPendingClarification(sessionKey)) {
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A clarification session is already in progress. Answer the pending question before starting something new."
    });
  }
  const memoryBlock = formatMemoryBlock(sessionKey);
  const hasMemory = memoryBlock.length > 0;
  const questions = hasMemory ? SHORT_PLANNING_QUESTIONS : FIXED_PLANNING_QUESTIONS;
  const memoryContext = hasMemory ? memoryBlock : null;

  startClarification(sessionKey, { description: planCommand.description, questions, memoryContext });

  return res.json({
    success: true,
    action: "clarification_question",
    question: getCurrentQuestion(sessionKey),
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
async function generateAndReturnPlan(description, res, blueprint, sessionKey) {
  try {
    const MAX_PLANNING_ROUNDS = 6; // safety ceiling: rounds of generateBatchPlan calls, not files
    const estimatedFiles = (blueprint && blueprint.estimatedFiles) || null;

    let allFiles = [];
    let rounds = 0;

    let roundFailures = 0;

    while (true) {
      rounds += 1;
      let roundFiles;
      try {
        const result = await generateBatchPlan({
          description,
          completedFiles: allFiles.map((f) => f.path),
          blueprint
        }, sessionKey);
        roundFiles = result.files;
      } catch (err) {
        roundFailures += 1;
        console.error(`[planLoop] round ${rounds} failed (attempt ${roundFailures}):`, err.message);
        if (roundFailures >= 2) {
          // Two failures in a row — stop gracefully with whatever real
          // progress has already been accumulated, rather than throwing
          // away every prior successful round over one bad round's output.
          break;
        }
        rounds -= 1; // this attempt didn't count as a real round; retry
        continue;
      }
      roundFailures = 0; // reset on any successful round

      console.log(`[planLoop] round ${rounds} succeeded: ${Array.isArray(roundFiles) ? roundFiles.length : 0} file(s) returned`);

      if (!Array.isArray(roundFiles) || roundFiles.length === 0) {
        console.log("[planLoop] stopping: model returned empty/no files (genuine completion signal)");
        break; // model signaled done
      }

      const existingPaths = new Set(allFiles.map((f) => f.path));
      const newFiles = roundFiles.filter((f) => !existingPaths.has(f.path));
      allFiles = allFiles.concat(newFiles);

      if (estimatedFiles && allFiles.length >= estimatedFiles) {
        console.log(`[planLoop] stopping: reached estimatedFiles (${allFiles.length}/${estimatedFiles})`);
        break; // reached the blueprint's estimated scope
      }
      if (newFiles.length === 0) {
        console.log("[planLoop] stopping: round produced nothing new");
        break; // round produced nothing new — avoid an infinite loop
      }
      if (rounds >= MAX_PLANNING_ROUNDS) {
        console.log(`[planLoop] stopping: hit MAX_PLANNING_ROUNDS ceiling (${rounds})`);
        break; // safety ceiling hit
      }
    }

    if (allFiles.length === 0) {
      return res.status(500).json({
        success: false,
        action: "plan_rejected",
        reason: "The generated plan did not contain any files."
      });
    }

    let validationIssues = [
      ...checkVocabularyConsistency(allFiles, blueprint),
      ...checkExcludedScope(allFiles, description),
      ...checkMissingRequiredScope(allFiles, description)
    ];

    // Auto-fix 1: excluded_scope issues are cheap to resolve — just drop the
    // offending file(s) from the plan. No model call needed; removing a file
    // that shouldn't exist doesn't require asking the model anything.
    const excludedPaths = new Set(
      validationIssues.filter((i) => i.type === "excluded_scope").map((i) => i.path)
    );
    if (excludedPaths.size > 0) {
      allFiles = allFiles.filter((f) => !excludedPaths.has(f.path));
      validationIssues = [
        ...checkVocabularyConsistency(allFiles, blueprint),
        ...checkExcludedScope(allFiles, description),
        ...checkMissingRequiredScope(allFiles, description)
      ];
    }

    // Auto-fix 2: vocabulary_inconsistency issues get a cheap single-file
    // description rewrite — one small model call per flagged file, not a
    // full replan. The file's real content/purpose doesn't change, only
    // the wording of its description.
    const vocabIssues = validationIssues.filter((i) => i.type === "vocabulary_inconsistency");
    if (vocabIssues.length > 0 && blueprint && blueprint.database) {
      for (const issue of vocabIssues) {
        const fileIndex = allFiles.findIndex((f) => f.path === issue.path);
        if (fileIndex === -1) continue;
        try {
          const fixedDescription = await generateDescriptionFix({
            path: issue.path,
            description: allFiles[fileIndex].description,
            databaseName: blueprint.database,
            issueDetail: issue.detail
          });
          if (fixedDescription) {
            allFiles[fileIndex] = { ...allFiles[fileIndex], description: fixedDescription };
          }
        } catch (err) {
          console.error(`[planValidator] description fix failed for ${issue.path}:`, err.message);
          // Leave the original description in place; it'll still be flagged
          // below by re-validation rather than silently swapped for nothing.
        }
      }
      validationIssues = [
        ...checkVocabularyConsistency(allFiles, blueprint),
        ...checkExcludedScope(allFiles, description),
        ...checkMissingRequiredScope(allFiles, description)
      ];
    }

    // Auto-fix 3: missing_required_scope issues get a targeted addition —
    // one extra generateBatchPlan-style call asking specifically for the
    // missing area, not a full replan. completedFiles is passed so the
    // model doesn't duplicate what's already planned.
    const missingIssues = validationIssues.filter((i) => i.type === "missing_required_scope");
    if (missingIssues.length > 0) {
      for (const issue of missingIssues) {
        const areaMatch = issue.detail.match(/require "([^"]+)"/);
        const area = areaMatch ? areaMatch[1] : null;
        if (!area) continue;
        try {
          const rawAddition = await generateTargetedAddition({
            area,
            blueprint,
            existingPaths: allFiles.map((f) => f.path)
          });
          const cleanedAddition = stripCodeFences(rawAddition);
          const additionFiles = lenientJsonParse(cleanedAddition);
          console.log(`[planValidator] targeted addition for "${area}": model returned`, JSON.stringify(additionFiles));
          if (Array.isArray(additionFiles) && additionFiles.length > 0) {
            const existingPaths = new Set(allFiles.map((f) => f.path));
            const newFiles = additionFiles.filter((f) => !existingPaths.has(f.path));
            allFiles = allFiles.concat(newFiles);
          }
        } catch (err) {
          console.error(`[planValidator] targeted addition failed for "${area}":`, err.message);
        }
      }
      validationIssues = [
        ...checkVocabularyConsistency(allFiles, blueprint),
        ...checkExcludedScope(allFiles, description),
        ...checkMissingRequiredScope(allFiles, description)
      ];
    }

    const incomplete = estimatedFiles ? allFiles.length < estimatedFiles : false;

    let campaignInfo = null;
    let firstBatchFiles = allFiles;
    if (allFiles.length > MAX_PLAN_FILES) {
      const remainingFiles = allFiles.slice(MAX_PLAN_FILES);
      firstBatchFiles = allFiles.slice(0, MAX_PLAN_FILES);
      const campaign = startCampaign(sessionKey, { description, remainingFiles });
      campaignInfo = { campaignId: campaign.id, batchNumber: campaign.batchNumber };
    }

    const plan = createPlan(sessionKey, { description, files: firstBatchFiles });

    return res.json({
      success: true,
      action: "plan_proposed",
      planId: plan.id,
      description: plan.description,
      files: plan.files,
      estimatedFiles,
      planningRounds: rounds,
      incomplete,
      validationIssues,
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


function handleExecutePlanCommand(executePlanCommand, res, sessionKey) {
  if (executePlanCommand.malformed) {
    return res.status(400).json({
      success: false,
      action: "plan_rejected",
      reason: executePlanCommand.reason
    });
  }

  if (hasPendingPlan(sessionKey)) {
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A plan is already pending review. Approve or reject it before starting a new one."
    });
  }

  if (hasActiveCampaign(sessionKey)) {
    const campaign = getActiveCampaign(sessionKey);
    return res.status(409).json({
      success: false,
      action: "plan_rejected",
      reason: "A multi-batch task is already in progress (batch " + campaign.batchNumber + "). Approve or reject the current batch before starting something new."
    });
  }

  const allFiles = executePlanCommand.files;
  const estimatedFiles = allFiles.length;

  // No blueprint exists for human-supplied plans (executePlanCommandParser
  // only parses description + files), so checkVocabularyConsistency is
  // skipped — it no-ops gracefully without a blueprint anyway. The other
  // two checks only need description + files, both available here, so a
  // human can still be caught forgetting an explicitly-required area or
  // including an explicitly-excluded one, same as an AI-generated plan.
  const validationIssues = [
    ...checkExcludedScope(allFiles, executePlanCommand.description),
    ...checkMissingRequiredScope(allFiles, executePlanCommand.description)
  ];

  let campaignInfo = null;
  let firstBatchFiles = allFiles;
  if (allFiles.length > MAX_PLAN_FILES) {
    const remainingFiles = allFiles.slice(MAX_PLAN_FILES);
    firstBatchFiles = allFiles.slice(0, MAX_PLAN_FILES);
    const campaign = startCampaign(sessionKey, { description: executePlanCommand.description, remainingFiles });
    campaignInfo = { campaignId: campaign.id, batchNumber: campaign.batchNumber };
  }

  const plan = createPlan(sessionKey, { description: executePlanCommand.description, files: firstBatchFiles });

  return res.json({
    success: true,
    action: "plan_proposed",
    planId: plan.id,
    description: plan.description,
    files: plan.files,
    estimatedFiles,
    incomplete: allFiles.length > MAX_PLAN_FILES,
    validationIssues,
    campaign: campaignInfo,
    isHumanSupplied: true
  });
}

app.post("/api/chat", requireAuth, async (req, res) => {
  const { prompt, history, projectName } = req.body;
  const sessionKey = getSessionKey(req);

  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (payload && payload.action) {
      appendAssistantTurn(sessionKey, {
        action: payload.action,
        data: payload,
        content: summarizeForModel(payload)
      });
    }
    return originalJson(payload);
  };

  if (prompt) {
    appendUserTurn(sessionKey, prompt);
  }

  if (!prompt) {
    return res.status(400).json({ success: false, error: "prompt is required" });
  }
  if (hasPendingClarification(sessionKey)) {
    const phase = getPhase(sessionKey);
    const trimmedPrompt = prompt.trim();
    const confirmPattern = /^(yes|yep|yeah|correct|looks good|proceed|go ahead|that'?s right|sounds good|confirmed|ok|okay|approve)\b/i;

    const looksLikeNewPlanCommand = /^plan:\s*/i.test(trimmedPrompt) || /^execute plan:\s*/i.test(trimmedPrompt);
    const looksLikeCancel = /^cancel$/i.test(trimmedPrompt);

    if (looksLikeCancel) {
      const cancelledDescription = getPendingClarification(sessionKey).description;
      clearClarification(sessionKey);
      return res.json({
        success: true,
        action: "clarification_cancelled",
        message: "Cancelled the pending clarification for \"" + cancelledDescription + "\". You can start a new plan: request now."
      });
    }

    if (looksLikeNewPlanCommand) {
      const pending = getPendingClarification(sessionKey);
      return res.status(409).json({
        success: false,
        action: "plan_rejected",
        reason: "You have a clarification session already in progress for \"" + pending.description + "\". Answer the current question, or reply \"cancel\" to abandon it and start something new."
      });
    }

    const isConfirmation = confirmPattern.test(trimmedPrompt);

    if (phase === "summary") {
      if (!isConfirmation) {
        const revisedDescription = getEnrichedDescription(sessionKey) + "\n\nRevision from the user:\n" + trimmedPrompt;
        setEnrichedDescription(sessionKey, revisedDescription);
        return res.json({
          success: true,
          action: "requirements_summary",
          summary: revisedDescription,
          message: "Updated. Does this accurately capture your requirements? Reply \"approve\" to continue, or tell me what to add or change (for example: \"also add a mobile app\" or \"remove the tagging feature\")."
        });
      }

      const enrichedDescription = getEnrichedDescription(sessionKey);
      const relevantFiles = searchIndex(sessionKey, enrichedDescription, 5);

      if (!relevantFiles || relevantFiles.length === 0) {
        try {
          const rawBlueprint = await generateBlueprint(enrichedDescription);
          const cleanedBlueprint = stripCodeFences(rawBlueprint);
          const blueprint = lenientJsonParse(cleanedBlueprint);
          beginBlueprintConfirmation(sessionKey, { blueprint });
          return res.json({
            success: true,
            action: "architecture_blueprint",
            blueprint,
            message: "Here's the proposed architecture. Reply \"looks good\" to proceed, or tell me specifically what to change (for example: \"use PostgreSQL instead of MongoDB\")."
          });
        } catch (err) {
          console.error("Blueprint generation failed, proceeding without it:", err.message);
          clearClarification(sessionKey);
          return generateAndReturnPlan(enrichedDescription, res, undefined, sessionKey);
        }
      }

      beginArchitectureConfirmation(sessionKey, { relevantFiles });
      return res.json({
        success: true,
        action: "architecture_context_check",
        relevantFiles: relevantFiles.map((f) => f.path),
        message: "These existing files look relevant to this task. Reply with something like \"looks good\" to proceed, or describe what's missing or incorrect."
      });
    }

    if (phase === "architecture") {
      let finalDescription = getEnrichedDescription(sessionKey);
      if (!isConfirmation) {
        finalDescription = finalDescription + "\n\nCorrection from the user about the existing repository structure (this overrides anything assumed above about which files already exist or where they live):\n" + trimmedPrompt;
        setEnrichedDescription(sessionKey, finalDescription);
      }

      try {
        const rawBlueprint = await generateBlueprint(finalDescription);
        const cleanedBlueprint = stripCodeFences(rawBlueprint);
        const blueprint = lenientJsonParse(cleanedBlueprint);
        beginBlueprintConfirmation(sessionKey, { blueprint });
        return res.json({
          success: true,
          action: "architecture_blueprint",
          blueprint,
          message: "Here's the proposed architecture. Reply \"looks good\" to proceed, or tell me specifically what to change (for example: \"use PostgreSQL instead of MongoDB\")."
        });
      } catch (err) {
        console.error("Blueprint generation failed, proceeding without it:", err.message);
        clearClarification(sessionKey);
        return generateAndReturnPlan(finalDescription, res, undefined, sessionKey);
      }
    }
    if (phase === "blueprint") {
      if (!isConfirmation) {
        const correctedDescription = getEnrichedDescription(sessionKey) + "\n\nCorrection from the user about the architecture:\n" + trimmedPrompt;
        setEnrichedDescription(sessionKey, correctedDescription);

        try {
          const rawBlueprint = await generateBlueprint(correctedDescription);
          const cleanedBlueprint = stripCodeFences(rawBlueprint);
          const blueprint = lenientJsonParse(cleanedBlueprint);
          beginBlueprintConfirmation(sessionKey, { blueprint });
          return res.json({
            success: true,
            action: "architecture_blueprint",
            blueprint,
            message: "Updated. Here's the revised architecture. Reply \"looks good\" to proceed, or tell me specifically what to change (for example: \"use PostgreSQL instead of MongoDB\")."
          });
        } catch (err) {
          console.error("Blueprint regeneration failed, proceeding without further revision:", err.message);
          clearClarification(sessionKey);
          return generateAndReturnPlan(correctedDescription, res, undefined, sessionKey);
        }
      }

      const enrichedDescription = getEnrichedDescription(sessionKey);
      const blueprint = getBlueprint(sessionKey);
      const finalDescription = enrichedDescription + "\n\nAgreed architecture (technology choices below are binding, not suggestions):\n" + JSON.stringify(blueprint);

      clearClarification(sessionKey);
      return generateAndReturnPlan(finalDescription, res, blueprint, sessionKey);
    }



    const skipPattern = /best judgment|you decide|not sure|don'?t know|^skip$|up to you|whatever you think|your call/i;
    const skipped = skipPattern.test(trimmedPrompt);

    recordAnswer(sessionKey, { answer: trimmedPrompt, skipped });

    if (isComplete(sessionKey)) {
      const summary = buildRequirementsSummary(sessionKey);
      const pending = getPendingClarification(sessionKey);
      setEnrichedDescription(sessionKey, pending.description + "\n\nRequirements summary:\n" + summary);
      setPhase(sessionKey, "summary");

      return res.json({
        success: true,
        action: "requirements_summary",
        summary,
        message: "Does this accurately capture your requirements? Reply \"approve\" to continue, or tell me what to add or change (for example: \"also add a mobile app\" or \"remove the tagging feature\")."
      });
    }

    const clarification = getPendingClarification(sessionKey);
    return res.json({
      success: true,
      action: "clarification_question",
      question: getCurrentQuestion(sessionKey),
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
    const result = addFact(sessionKey, rememberCommand.fact);
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
    return handleWriteCommand(parsedCommand, res, sessionKey);
  }

  const fixCommand = parseFixCommand(prompt);
  if (fixCommand.isFixCommand) {
    return handleFixCommand(fixCommand, res, sessionKey);
  }

  const documentCommand = parseDocumentCommand(prompt);
  if (documentCommand.isDocumentCommand) {
    return handleDocumentCommand(res, sessionKey);
  }

  const testCommand = parseTestCommand(prompt);
  if (testCommand.isTestCommand) {
    return handleRunTestsCommand(res, sessionKey);
  }

  const gitCommand = parseGitCommand(prompt);
  if (gitCommand.type === "status") {
    return handleGitStatusCommand(res, sessionKey);
  }
  if (gitCommand.type === "diff") {
    return handleGitDiffCommand(res, sessionKey);
  }
  if (gitCommand.type === "commit") {
    return handleGitCommitCommand(res, sessionKey);
  }

  const installCommand = parseInstallCommand(prompt);
  if (installCommand.isInstallCommand) {
    return handleInstallCommand(installCommand, res, sessionKey);
  }

  const testGenCommand = parseTestGenerationCommand(prompt);
  if (testGenCommand.isTestGenerationCommand) {
    return handleWriteTestsCommand(testGenCommand.targetPath, res, sessionKey);
  }

  const executePlanCommand = parseExecutePlanCommand(prompt);
  if (executePlanCommand.isExecutePlanCommand) {
    return handleExecutePlanCommand(executePlanCommand, res, sessionKey);
  }

  const planCommand = parsePlanCommand(prompt);
  if (planCommand.isPlanCommand) {
    return handlePlanCommand(planCommand, res, sessionKey);
  }

  // Guard against a real safety gap: none of the specific command parsers
  // above matched, but if something is genuinely pending resolution via a
  // dedicated button (plan, diffs, clarification, tool action, write),
  // falling through to open-ended model chat risks the model hallucinating
  // a plausible-sounding but false confirmation, for text that merely
  // resembles a button label without matching it exactly. Caught live:
  // typing "apply all" or "approve plan" as free text while a plan was
  // genuinely pending produced exactly this kind of false confirmation.
  if (hasPendingAction(sessionKey)) {
    return res.status(400).json({
      success: false,
      action: "pending_action_unresolved",
      reason: "There's a pending action awaiting your decision. Please use the approve/reject buttons above rather than typing a reply."
    });
  }
  if (hasPendingWrite(sessionKey)) {
    return res.status(400).json({
      success: false,
      action: "pending_action_unresolved",
      reason: "There's a pending file write awaiting your decision. Please use the approve/reject buttons above rather than typing a reply."
    });
  }
  if (hasPendingPlan(sessionKey)) {
    const pendingPlan = getPendingPlan(sessionKey);
    const stageLabel = pendingPlan.stage === "diffs_proposed" ? "diffs" : "plan";
    return res.status(400).json({
      success: false,
      action: "pending_action_unresolved",
      reason: "There's a pending " + stageLabel + " awaiting your decision. Please use the approve/reject buttons above rather than typing a reply."
    });
  }
  if (hasPendingClarification(sessionKey)) {
    return res.status(400).json({
      success: false,
      action: "pending_action_unresolved",
      reason: "There's a pending question or confirmation awaiting your reply. Please answer it directly, or use the button above if one is shown."
    });
  }

  const fullPrompt = buildFullPrompt(prompt, loadHistory(sessionKey), sessionKey);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let accumulatedResponse = "";
  let ollamaBuffer = "";
  let streamFinished = false;

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

    const processOllamaLine = (line) => {
      if (!line.trim() || streamFinished) return;

      try {
        const parsed = JSON.parse(line);

        if (parsed.response) {
          accumulatedResponse += parsed.response;
          res.write(`data: ${JSON.stringify({ token: parsed.response })}\n\n`);
        }

        if (parsed.done && !streamFinished) {
          streamFinished = true;

          appendAssistantTurn(sessionKey, {
            action: "chat_reply",
            data: { content: accumulatedResponse },
            content: accumulatedResponse
          });

          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        }
      } catch (e) {
        console.error("[Ollama] Failed to parse JSON:", e.message);
      }
    };

    response.data.on("data", (chunk) => {
      ollamaBuffer += chunk.toString();

      const lines = ollamaBuffer.split("\n");
      ollamaBuffer = lines.pop() || "";

      for (const line of lines) {
        processOllamaLine(line);
      }
    });

    response.data.on("end", () => {
      if (ollamaBuffer.trim() && !streamFinished) {
        processOllamaLine(ollamaBuffer);
      }

      if (!streamFinished) {
        streamFinished = true;

        appendAssistantTurn(sessionKey, {
          action: "chat_reply",
          data: { content: accumulatedResponse },
          content: accumulatedResponse
        });

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
    });

    response.data.on("error", (err) => {
      console.error("Ollama stream error:", err.message);

      if (!streamFinished) {
        streamFinished = true;
        res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
        res.end();
      }
    });
  } catch (error) {
    console.error("Ollama request failed:", error.message);

    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  }
});

app.post("/api/write", requireAuth, (req, res) => {
  const sessionKey = getSessionKey(req);
  const { targetPath, content } = req.body;

  if (!targetPath || typeof content !== "string") {
    return res.status(400).json({ success: false, error: "targetPath and content are required" });
  }

  // NEVER trust that a path was already validated in a previous request.
  // Re-check it fresh, here, right before any disk write happens.
  const safetyCheck = isPathSafe(sessionKey, targetPath);

  if (!safetyCheck.safe) {
    return res.status(400).json({
      success: false,
      action: "write_rejected",
      reason: safetyCheck.reason,
      attemptedPath: targetPath
    });
  }

  try {
    const backupPath = backupExistingFile(sessionKey, safetyCheck.resolvedPath, targetPath);

    fs.mkdirSync(path.dirname(safetyCheck.resolvedPath), { recursive: true });
    fs.writeFileSync(safetyCheck.resolvedPath, content, "utf-8");

    console.log(`[api/write] Wrote ${content.length} bytes to ${targetPath}`);

    clearPendingWrite(sessionKey);
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

app.post("/api/write/reject", requireAuth, (req, res) => {
  const sessionKey = getSessionKey(req);
  clearPendingWrite(sessionKey);
  res.json({ success: true, action: "write_rejected_ack" });
});

app.get("/api/plan/current", requireAuth, (req, res) => {
  const sessionKey = getSessionKey(req);
  const plan = getPendingPlan(sessionKey);
  if (!plan) {
    return res.json({ success: false, reason: "No pending plan" });
  }
  return res.json({ success: true, plan });
});

// Read-only debug/inspection endpoint: exposes the full active campaign,
// including remainingFiles, which /api/plan/current does not surface
// (it only shows the current batch). Useful for verifying multi-batch
// plans in full rather than one batch at a time.
app.get("/api/campaign/current", requireAuth, (req, res) => {
  const sessionKey = getSessionKey(req);
  const campaign = getActiveCampaign(sessionKey);
  if (!campaign) {
    return res.json({ success: false, reason: "No active campaign" });
  }
  return res.json({ success: true, campaign });
});

app.post("/api/plan/reject", requireAuth, (req, res) => {
  const sessionKey = getSessionKey(req);
  const { planId } = req.body;

  if (!isValidPlanId(sessionKey, planId)) {
    return res.status(400).json({ success: false, reason: "No matching pending plan to reject." });
  }

  clearPlan(sessionKey);

  let campaignCleared = false;
  if (hasActiveCampaign(sessionKey)) {
    clearCampaign(sessionKey);
    campaignCleared = true;
  }

  return res.json({ success: true, action: "plan_cleared", campaignCleared });
});

app.post("/api/plan/approve", requireAuth, async (req, res) => {
  const sessionKey = getSessionKey(req);
  const { planId } = req.body;

  if (!isValidPlanId(sessionKey, planId)) {
    return res.status(400).json({ success: false, reason: "No matching pending plan to approve." });
  }

  const plan = getPendingPlan(sessionKey);

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
      .map((f) => isPathSafe(sessionKey, f.path))
      .filter((check) => check.safe)
      .map((check) => check.resolvedPath);

    for (const file of plan.files) {
      const safetyCheck = isPathSafe(sessionKey, file.path);

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

      const stemOf = (p) => p.split("/").pop().replace(/\.[jt]sx?$/i, "").replace(/(Routes|Model|Controller|Service)$/i, "").toLowerCase();
      const isModelFile = (p) => /\/models\//i.test(p) || /Model\.[jt]sx?$/i.test(p);
      const targetStem = stemOf(file.path);
      const targetIsModel = isModelFile(file.path);
      const siblingFiles = {};
      for (const ef of enrichedFiles) {
        const efStem = stemOf(ef.path);
        const efName = ef.path.split("/").pop();
        const mentioned = file.description && (file.description.includes(efName) || file.description.toLowerCase().includes(efStem));
        const bothModels = targetIsModel && isModelFile(ef.path);
        if (efStem === targetStem || mentioned || bothModels) {
          siblingFiles[ef.path] = ef.after;
        }
      }

      const { content: cleanedContent, patchWarnings } = await generateFileContent({
        mode: fileExists ? "edit" : "write",
        targetPath: file.path,
        instruction: file.description,
        projectContext: plan.description,
      siblingFiles,
        existingContent: fileExists ? existingContent : null
      });

    const { checkSyntax } = require("./syntaxChecker");
    const syntaxResult = checkSyntax(cleanedContent);
    const { checkImports } = require("./importChecker");
    const importResult = checkImports(sessionKey, cleanedContent, safetyCheck.resolvedPath, batchSiblingPaths);
    const { checkLint } = require("./lintChecker");
    const lintResult = checkLint(cleanedContent);
    const { runTestsAgainstProposal } = require("./testRunner");
    const testCheck = runTestsAgainstProposal(safetyCheck.resolvedPath, cleanedContent);
    // Note: unlike the single-file routes, this does not hard-refuse on
    // failure -- it surfaces the real test result so a human reviewing
    // the batch diff can see it, without risking disruption to the
    // multi-file campaign loop's control flow.

    const { detectRouteRegressions } = require("./regressionChecker");
    const regressionWarnings = detectRouteRegressions(fileExists ? existingContent : null, cleanedContent);

    const { checkUndeclaredDependencies } = require("./packageJsonChecker");
    const undeclaredDependencies = checkUndeclaredDependencies(safetyCheck.resolvedPath, cleanedContent);

      enrichedFiles.push({
        path: file.path,
        description: file.description,
        before: fileExists ? existingContent : "",
        after: cleanedContent,
        patchWarnings,
      syntaxCheck: syntaxResult,
      importCheck: importResult,
      lintCheck: lintResult,
      testCheck,
      regressionWarnings,
      undeclaredDependencies,
        mode: fileExists ? "edit" : "write"
      });
    }

    const { validateGeneratedCode } = require("./codeValidator");
    const { getWorkspaceDir } = require("./workspaceResolver");
    let batchBlueprint = null;
    const blueprintMatch = plan.description.match(/Agreed architecture \(technology choices below are binding, not suggestions\):\s*(\{[\s\S]*\})/);
    if (blueprintMatch) {
      try {
        batchBlueprint = lenientJsonParse(blueprintMatch[1]);
      } catch (err) {
        console.error("codeValidator: could not parse blueprint from plan description:", err.message);
      }
    }

    // The validator needs visibility into already-applied model files, not
    // just the current batch -- models are frequently applied in an
    // earlier, separate batch (e.g. models batch, then a later routes
    // batch referencing them), and enrichedFiles alone only ever contains
    // the CURRENT batch's files. Read any already-applied models/*.js
    // files from disk and merge them in (read-only merge, never written
    // back -- these are only used as extra context for the validator).
    let alreadyAppliedModelFiles = [];
    try {
      const workspaceDir = getWorkspaceDir(sessionKey);
      const modelsDir = path.join(workspaceDir, "backend", "models");
      if (fs.existsSync(modelsDir)) {
        const modelFilenames = fs.readdirSync(modelsDir).filter((f) => /\.[jt]sx?$/i.test(f));
        alreadyAppliedModelFiles = modelFilenames
          .filter((f) => !enrichedFiles.some((ef) => ef.path.endsWith("models/" + f)))
          .map((f) => ({
            path: "backend/models/" + f,
            after: fs.readFileSync(path.join(modelsDir, f), "utf-8")
          }));
      }
    } catch (err) {
      console.error("codeValidator: could not read already-applied model files:", err.message);
    }

    console.log("[codeValidator debug] workspaceDir models check -- alreadyAppliedModelFiles.length:", alreadyAppliedModelFiles.length, alreadyAppliedModelFiles.map(f => f.path));
    console.log("[codeValidator debug] batchBlueprint:", JSON.stringify(batchBlueprint));
    const codeValidationIssues = validateGeneratedCode([...enrichedFiles, ...alreadyAppliedModelFiles], batchBlueprint)
      .filter((issue) => enrichedFiles.some((ef) => ef.path === issue.path));
    console.log("[codeValidator debug] issues found:", codeValidationIssues.length, JSON.stringify(codeValidationIssues));

    const enrichResult = enrichWithDiffs(sessionKey, planId, enrichedFiles);

    if (!enrichResult.success) {
      return res.status(400).json({ success: false, reason: enrichResult.reason });
    }

    enrichResult.plan.codeValidationIssues = codeValidationIssues;

    return res.json({
      success: true,
      action: "diffs_proposed",
      planId,
      files: enrichedFiles,
      codeValidationIssues
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
function saveArchitectureToMemory(description, sessionKey) {
  const match = description.match(/Agreed architecture \(technology choices below are binding, not suggestions\):\s*(\{[\s\S]*\})/);
  if (!match) return;

  try {
    const blueprint = lenientJsonParse(match[1]);
    const fact = `Established project architecture: ${blueprint.frontend} frontend, ${blueprint.backend} backend, ${blueprint.database} database, ${blueprint.authentication} authentication.`;
    addFact(sessionKey, fact);
  } catch (err) {
    console.error("Could not save architecture to project memory:", err.message);
  }
}

app.post("/api/plan/apply", requireAuth, async (req, res) => {
  const { planId } = req.body;
  const sessionKey = getSessionKey(req);

  if (!isValidPlanId(sessionKey, planId)) {
    return res.status(400).json({ success: false, reason: "No matching pending plan to apply." });
  }

  const plan = getPendingPlan(sessionKey);

  if (plan.stage !== "diffs_proposed") {
    return res.status(400).json({
      success: false,
      reason: "Plan diffs have not been approved yet. Current stage: " + plan.stage
    });
  }

  const results = [];

  for (const file of plan.files) {
    const safetyCheck = isPathSafe(sessionKey, file.path);

    if (!safetyCheck.safe) {
      return res.status(400).json({
        success: false,
        action: "apply_halted",
        reason: "Path safety check failed for " + file.path + ": " + safetyCheck.reason,
        filesWritten: results
      });
    }

    try {
      const backupPath = backupExistingFile(sessionKey, safetyCheck.resolvedPath, file.path);
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
  clearPlan(sessionKey);
  saveArchitectureToMemory(plan.description, sessionKey);

  if (!hasActiveCampaign(sessionKey)) {
    return res.json({
      success: true,
      action: "plan_applied",
      filesWritten: results
    });
  }

  const campaignBefore = getActiveCampaign(sessionKey);
  recordBatchCompletion(sessionKey, campaignBefore.id, appliedPaths);

  try {
    syncReindexWorkspace(sessionKey);

    const campaign = getActiveCampaign(sessionKey);
    const { files: nextFiles, remainingCount } = takeNextBatch(sessionKey, campaign.id, MAX_PLAN_FILES);

    if (!Array.isArray(nextFiles) || nextFiles.length === 0) {
      const finishedCampaign = campaign;
      clearCampaign(sessionKey);
      return res.json({
        success: true,
        action: "plan_applied",
        filesWritten: results,
        campaignComplete: true,
        totalBatches: finishedCampaign.batchNumber - 1
      });
    }

    const nextPlan = createPlan(sessionKey, { description: campaign.description, files: nextFiles });

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
    clearCampaign(sessionKey);
    return res.json({
      success: true,
      action: "plan_applied",
      filesWritten: results,
      campaignError: "Could not continue to the next batch automatically: " + err.message
    });
  }
});

app.post("/api/projects", requireAuth, (req, res) => {
  try {
    const rawProjectName = req.body && req.body.projectName;

    if (typeof rawProjectName !== "string" || !rawProjectName.trim()) {
      return res.status(400).json({
        success: false,
        error: "Project name is required"
      });
    }

    const { sanitizeKeyPart } = require("./sanitize");
    const studentId = sanitizeKeyPart(req.userId);
    const projectName = sanitizeKeyPart(rawProjectName.trim());

    if (!studentId || !projectName) {
      return res.status(400).json({
        success: false,
        error: "Invalid project name"
      });
    }

    const existingProjects = listProjectsForStudent(req.userId);

    if (existingProjects.includes(projectName)) {
      return res.status(409).json({
        success: false,
        error: "Project already exists",
        projectName
      });
    }

    const sessionKey = `${studentId}:${projectName}`;

    // Project creation is the ONLY place that intentionally
    // creates a new workspace directory.
    const workspaceDir = ensureWorkspace(sessionKey);

    // Now that the workspace exists, start its watcher.
    const { ensureWatching } = require("./fileIndexer");
    ensureWatching(sessionKey);

    return res.status(201).json({
      success: true,
      projectName,
      workspaceCreated: true,
      workspaceDir,
      message: `Project "${projectName}" created successfully`
    });
  } catch (err) {
    console.error("[projectCreation] Failed:", err);

    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.delete("/api/projects/:projectName", requireAuth, (req, res) => {
  try {
    const projectName = req.params.projectName;

    if (!projectName) {
      return res.status(400).json({
        success: false,
        error: "Project name is required"
      });
    }

    // Deletion is irreversible, so require explicit confirmation at the
    // API level too — not just in the frontend's confirmation dialog.
    // Protects against this endpoint ever being called directly (a
    // script, a future agent, manual testing) without going through the
    // UI's confirmation step.
    if (req.query.confirm !== "true") {
      return res.status(400).json({
        success: false,
        error: "Deletion requires ?confirm=true — this action is irreversible."
      });
    }

    const studentId = req.userId;
    const { sanitizeKeyPart } = require("./sanitize");
    const sessionKey = `${sanitizeKeyPart(studentId)}:${sanitizeKeyPart(projectName)}`;

    const result = deleteProject(sessionKey);

    return res.json(result);
  } catch (err) {
    console.error("[projectDeletion] Failed:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get("/api/projects", requireAuth, (req, res) => {
  try {
    const projects = listProjectsForStudent(req.userId);
    res.json({ success: true, projects });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/files", requireAuth, (req, res) => {
  const sessionKey = getSessionKey(req);
  try {
    const tree = buildTree(sessionKey);
    res.json({ success: true, tree });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/session/current", requireAuth, (req, res) => {
  const sessionKey = getSessionKey(req);

  if (hasPendingAction(sessionKey)) {
    return res.json({ success: true, pending: "toolAction", data: getPendingAction(sessionKey) });
  }

  if (hasPendingPlan(sessionKey)) {
    const plan = getPendingPlan(sessionKey);
    if (plan.stage === "diffs_proposed") {
      return res.json({ success: true, pending: "diffs", data: { planId: plan.id, files: plan.files, codeValidationIssues: plan.codeValidationIssues || [] } });
    }
    return res.json({ success: true, pending: "plan", data: { planId: plan.id, description: plan.description, files: plan.files } });
  }

  if (hasPendingWrite(sessionKey)) {
    return res.json({ success: true, pending: "write", data: getPendingWrite(sessionKey) });
  }

  if (hasPendingClarification(sessionKey)) {
    const clarification = getPendingClarification(sessionKey);
    const phase = getPhase(sessionKey);

    if (phase === "blueprint") {
      return res.json({
        success: true,
        pending: "architectureBlueprint",
        data: {
          blueprint: clarification.blueprint,
          message: "Here's the proposed architecture. Reply \"looks good\" to proceed, or tell me specifically what to change (for example: \"use PostgreSQL instead of MongoDB\")."
        }
      });
    }

    if (phase === "architecture") {
      return res.json({
        success: true,
        pending: "architectureContextCheck",
        data: {
          relevantFiles: clarification.relevantFiles,
          message: "These existing files look relevant to this task. Reply with something like \"looks good\" to proceed, or describe what's missing or incorrect."
        }
      });
    }

    if (phase === "summary") {
      return res.json({
        success: true,
        pending: "requirementsSummary",
        data: {
          summary: clarification.summaryText,
          message: "Does this accurately capture your requirements? Reply \"approve\" to continue, or tell me what to add or change."
        }
      });
    }

    return res.json({
      success: true,
      pending: "clarificationQuestion",
      data: {
        question: getCurrentQuestion(sessionKey),
        questionNumber: clarification.currentIndex + 1,
        totalQuestions: clarification.questions.length,
        usingProjectMemory: !!clarification.memoryContext
      }
    });
  }

  return res.json({ success: true, pending: null });
});

app.get("/api/chat/history", requireAuth, (req, res) => {
  const sessionKey = getSessionKey(req);
  const history = loadHistory(sessionKey);
  res.json({ success: true, history });
});

app.listen(5000, () => {
  console.log("Taifa AI Backend running on port 5000");
});
