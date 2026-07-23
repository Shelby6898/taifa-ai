const axios = require("axios");

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL_NAME = "qwen2.5-coder-6k";

function buildGenerationPrompt({ mode, targetPath, instruction, existingContent, projectContext }) {
  const contextSection = projectContext
    ? `Broader project context and requirements, gathered before this file was planned (this may include project-wide technology or architecture constraints — you MUST honor these even if the specific instruction below does not repeat them):\n${projectContext}\n\n`
    : "";

  const finalReminder = projectContext
    ? `\n\nIMPORTANT — before you write any code: re-read the project context above and identify any specific technology it names (for example a particular database, framework, or library). You MUST use exactly that technology in the code you write. Do NOT default to Mongoose, MongoDB, or any other common pattern from your training data if a different technology was explicitly specified above — using the wrong technology here is a critical error even if the rest of the code is otherwise correct.`
    : "";

  if (mode === "edit" && existingContent) {
    return `You are editing an existing code file at path "${targetPath}".

${contextSection}Current file content:
${existingContent}

Instruction: ${instruction}${finalReminder}

Do NOT output the entire file. Instead, output one or more SEARCH/REPLACE blocks describing only the specific change(s) needed, in exactly this format:

<<<<<<< SEARCH
(exact snippet of code copied verbatim from the current file content above, including exact whitespace and indentation)
=======
(the new code that should replace it)
>>>>>>> REPLACE

Rules:
- Each SEARCH block must be copied EXACTLY, character for character, from the current file content shown above. Do not paraphrase, reformat, or fix whitespace -- copy it verbatim.
- Keep each SEARCH block as short as possible while still being unique enough to identify only ONE location in the file. A few lines is usually enough. Do not include unrelated surrounding code that isn't changing.
- Only include SEARCH/REPLACE blocks for the parts of the file that actually need to change. Do NOT reproduce, repeat, or rewrite any part of the file that isn't changing -- leave it out entirely.
- If multiple separate parts of the file need to change, output multiple SEARCH/REPLACE blocks, one after another.
- Output ONLY the SEARCH/REPLACE block(s). No explanation, no markdown code fences, no other text before or after.`;
  }

  return `You are creating a new code file at path "${targetPath}".

${contextSection}Instruction: ${instruction}${finalReminder}

Output ONLY the complete file content. Do not include any explanation, introduction, or markdown code fences. Output raw code only, starting from the first line of the file.`;
}

function buildFixPrompt({ targetPath, errorText, existingContent }) {
  return `You are fixing a bug in an existing code file at path "${targetPath}".

Current file content:
${existingContent}

The following error occurred. Note: this error text may be condensed onto a single line rather than formatted as a multi-line stack trace — read it carefully to identify the actual error type and root cause regardless of formatting:

${errorText}

Before producing the fix, identify what specifically in the code above causes this error (for example: a missing null/undefined check, a missing required field, an incorrect variable reference, a type mismatch). The fix must make a REAL functional change that prevents this specific error from happening again — not just a cosmetic change like moving a comment or reformatting a line.

Do NOT output the entire file. Instead, output one or more SEARCH/REPLACE blocks describing only the specific fix needed, in exactly this format:

<<<<<<< SEARCH
(exact snippet of code copied verbatim from the current file content above, including exact whitespace and indentation)
=======
(the corrected code that should replace it)
>>>>>>> REPLACE

Rules:
- Each SEARCH block must be copied EXACTLY, character for character, from the current file content shown above.
- Keep each SEARCH block as short as possible while still being unique enough to identify only ONE location in the file.
- Only include SEARCH/REPLACE blocks for the specific lines that need to change to fix this error. Do NOT reproduce or rewrite any part of the file that isn't part of the fix.
- Output ONLY the SEARCH/REPLACE block(s). No explanation, no markdown code fences, no other text. If the file content above does not appear to actually be the cause of this error, make your best reasonable attempt at a fix anyway, still in SEARCH/REPLACE format.`;
}

function buildDocumentationPrompt({ fullIndex }) {
  return `You are writing a README.md file for a software project, based ONLY on the actual source files shown below.

Project files:
${fullIndex}

Critical rules:
- Only describe functionality that is ACTUALLY PRESENT in the code shown above.
- Do NOT invent features, files, or capabilities that are not in the code.
- If something about the project's purpose or architecture is unclear from the code alone, describe what you can observe factually rather than guessing confidently.
- If the code shown is incomplete or fragmentary, say so rather than filling in plausible-sounding details.

DEPENDENCIES RULE (follow this mechanically, do not infer or guess):
- Look through the code shown above character by character for literal require(...) or import ... from ... statements.
- List ONLY package names that appear in an ACTUAL require() or import statement you can see in the text above.
- Do NOT list a package because it seems typical for this kind of code, or because a similar project usually uses it. If you cannot point to the exact require/import line, do not list it.
- If you find zero require/import statements for external packages in the code shown, write "No external dependencies found in the files shown" instead of listing anything.

Write the README in Markdown format, including: a brief project title/description based on what the code actually does, a list of the files present and what each one appears to be responsible for, and the Dependencies section following the rule above exactly.

Output ONLY the README content in Markdown. Do not wrap it in code fences. Do not include any meta-commentary about this being a generated document.`;
}

function buildPlanPrompt({ description, fullIndex, completedFiles }) {
  const completedSection = completedFiles && completedFiles.length > 0
    ? `\nThis is a continuation of a larger task. The following files have ALREADY been completed in previous batches — do not recreate or re-propose them unless a further change to one of them is genuinely still needed:\n${completedFiles.map((f) => `- ${f}`).join("\n")}\n\nIf the task described below is now fully accomplished by the files already completed, output an empty JSON array: []\n`
    : "";

  return `You are planning a multi-file code change for an existing project. You do NOT write any code yet — you only decide which files need to be created or modified.

Existing project files:
${fullIndex || "(workspace is currently empty)"}
${completedSection}
The user's request, including any answers they gave to clarifying questions (these are binding requirements — do not substitute your own preference for anything the user explicitly specified, such as a database or technology choice):\n${description}

Produce a plan as a JSON array. Each item must have exactly two fields:
- "path": a relative file path (e.g. "backend/routes/userRoutes.js")
- "description": one short sentence describing what this file should contain or how it should change

Rules:
- List ALL files this task genuinely needs to be complete, in priority order (most essential first). Do not artificially limit yourself to a small number — if the task needs 12 files, list all 12. A separate system will handle splitting this into batches, so your only job here is to think through the complete, real scope of the task.
- As a sanity bound, do not exceed 20 files even for a very large task — pick the 20 most essential if it seems larger than that.
- Reuse existing file paths from the project files shown above when the task means modifying something that already exists, rather than proposing a duplicate new file.
- Do not propose files unrelated to the user's request.
- If the user specified a particular technology, database, or architectural choice (for example, a specific database engine, framework, or auth approach), you MUST use exactly what they specified in the relevant file's description. Do not substitute a different technology you consider more common or convenient.
- If any part of the user's request explicitly states no preference was given and asks you to use your best judgment, you MUST state the specific assumption you made directly in that file's description (for example, "Uses JWT-based auth since no specific preference was given").

IMPORTANT — before producing the JSON: re-read the user's request above and identify the exact technology, database, or framework they specified, if any. Every file description that touches data storage, models, or persistence MUST name that exact technology by name.

Example — if the requirements specify Firestore:
WRONG: {"path": "backend/models/User.js", "description": "Defines the User model used by the backend."}
CORRECT: {"path": "backend/models/User.js", "description": "Defines the User model as a Firestore document with fields for name, email, and role."}

A vague description like "the User model" or "database model" is NOT acceptable when a specific technology was given in the requirements — always name it explicitly in the description text itself. Do NOT write a description that implies a different technology than what was specified — for example, do not write "MongoDB", "Mongoose", "SQL", or "relational database" in any file description unless the user specifically asked for one of those. This applies even under time pressure to produce a plan quickly; getting the named technology right is more important than speed.

Output ONLY the raw JSON array. Do not wrap it in markdown code fences. Do not include any explanation before or after the JSON. Example format:
[{"path": "backend/example.js", "description": "Adds an example function"}]`;
}

function buildClarifyingQuestionsPrompt(description) {
  return `A user wants the following built: "${description}"

Before planning the file structure, you need to ask 3 to 5 short, specific clarifying questions that would materially change what gets built. Focus on things that genuinely affect architecture and cannot be safely guessed: core entities/features involved, data storage choice, authentication/security requirements, and scale or deployment context. Do not ask generic or trivial questions.

Output ONLY a raw JSON array of question strings, nothing else. Example format:
["What are the main entities this system needs to track?", "Should this use a SQL or NoSQL database?", "Does this need user authentication, and if so, what roles?"]`;
}

async function generateClarifyingQuestions(description) {
  const prompt = buildClarifyingQuestionsPrompt(description);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false,
    options: { num_predict: 1500 }
  });

  return response.data.response;
}

// Edits and fixes ask the model for scoped SEARCH/REPLACE blocks rather
// than a full-file rewrite (see buildGenerationPrompt/buildFixPrompt),
// then mechanically apply those blocks to the real existing content
// here. This means the model can only ever change the exact snippets
// it names -- it structurally cannot silently drop or alter unrelated
// code elsewhere in the file, which full-file regeneration repeatedly
// did in manual testing. If the blocks don't parse, or don't match the
// real file content exactly once, this throws rather than guessing --
// callers already catch generation errors and surface them clearly.
function applyScopedEdit(rawModelOutput, existingContent) {
  const { parseSearchReplaceBlocks, applySearchReplaceBlocks } = require("./searchReplaceParser");
  const { stripCodeFences } = require("./stripCodeFences");

  // Models sometimes wrap the whole set of SEARCH/REPLACE blocks in a
  // single outer markdown fence despite instructions not to -- strip
  // that first, using the same utility already used elsewhere for
  // full-file generation, before attempting to parse blocks out of it.
  const cleanedOutput = stripCodeFences(rawModelOutput);

  const { blocks, parseError } = parseSearchReplaceBlocks(cleanedOutput);
  if (parseError) {
    throw new Error(`Scoped edit failed: ${parseError}`);
  }

  const result = applySearchReplaceBlocks(existingContent, blocks);
  if (!result.success) {
    throw new Error(`Scoped edit failed: ${result.reason}`);
  }

  return result.content;
}

async function generateFileContent(params) {
  const prompt = buildGenerationPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false,
    options: { num_predict: 1500 }
  });

  const rawOutput = response.data.response;

  if (params.mode === "edit" && params.existingContent) {
    return applyScopedEdit(rawOutput, params.existingContent);
  }

  return rawOutput;
}

async function generateFix(params) {
  const prompt = buildFixPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false,
    options: { num_predict: 1500 }
  });

  const rawOutput = response.data.response;

  return applyScopedEdit(rawOutput, params.existingContent);
}

async function generateDocumentation(params) {
  const prompt = buildDocumentationPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false,
    options: { num_predict: 1500 }
  });

  return response.data.response;
}

async function generatePlan(params) {
  const prompt = buildPlanPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false,
    options: { num_predict: 1500 }
  });

  return response.data.response;
}

function buildSelfReviewPrompt(code, verificationContext = {}) {
  const { syntaxCheck, importCheck, lintCheck } = verificationContext;

  const contextLines = [];
  if (syntaxCheck && syntaxCheck.valid === false) {
    contextLines.push(`- Syntax checker found this file INVALID: ${syntaxCheck.error || "unspecified syntax error"}`);
  }
  if (importCheck && importCheck.hasMissing) {
    contextLines.push(`- Import checker found MISSING imports: ${JSON.stringify(importCheck.missing || importCheck)}`);
  }
  if (lintCheck && Array.isArray(lintCheck) && lintCheck.length > 0) {
    contextLines.push(`- Lint checker found ${lintCheck.length} issue(s): ${lintCheck.map((l) => l.message || JSON.stringify(l)).join("; ")}`);
  }

  const automatedFindings = contextLines.length > 0
    ? `\n\nAutomated checks already found the following issues in this file — take these into account, and if they represent a real problem, you MUST answer YES and reference them:\n${contextLines.join("\n")}\n`
    : "\n\nAutomated syntax, import, and lint checks found no issues in this file.\n";

  return `You are reviewing a code snippet. Most code you review will be completely fine — only answer YES if there is a specific, concrete, undeniable bug such as a reference to an undefined variable, a misspelled identifier, or a clear logic error. Do not invent a problem that is not really there.

Example 1:
Code: function double(x) { return x * 2; }
Answer: NO

Example 2:
Code: function greet(name) { return "Hello " + nam; }
Answer: YES: "nam" is misspelled and should be "name", which will cause a ReferenceError.

Now review this code:
${code}
${automatedFindings}
Answer in exactly this format, nothing else:
NO
or
YES: <one short sentence describing the specific problem>`;
}

async function generateSelfReview(code, verificationContext = {}) {
  const prompt = buildSelfReviewPrompt(code, verificationContext);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false,
    options: { num_predict: 1500 }
  });

  return response.data.response;
}

function buildTestGenerationPrompt({ sourceFilePath, sourceFileContent, testFilePath, existingTestContent, moduleSystem }) {
  const editSection = existingTestContent
    ? `There is already a test file at ${testFilePath} with this content, which you should update rather than replace with something unrelated:
${existingTestContent}

`
    : "";

  const moduleSystemInstruction = moduleSystem === "module"
    ? `This project location uses ES modules (package.json has "type": "module"). You MUST use "import { test } from 'node:test';" and "import assert from 'node:assert';" at the top, and import the function being tested with ES import syntax (e.g. import { functionName } from './fileName.js';). Do NOT use require() anywhere in this file — require is not defined in this context and the file will crash immediately if you use it.`
    : `This project location uses CommonJS. You MUST use require() for all imports (e.g. const { test } = require('node:test'); const assert = require('node:assert'); const { functionName } = require('./fileName');). Do NOT use import/export syntax anywhere in this file — it will cause a SyntaxError in this context.`;

  return `Write a real, meaningful test file using Node's built-in test runner.

${moduleSystemInstruction}

The file being tested is at ${sourceFilePath}. Its ACTUAL current content is:
${sourceFileContent}

${editSection}Requirements:
- Import the actual exported function(s) from "${sourceFilePath}" using the correct relative path and the SAME export style already used in that file (named export vs default export — look at the actual code above, do not guess).
- Include at least one test case for clearly valid/expected input, and at least one test case for invalid or edge-case input.
- Do NOT write placeholder or trivially-true assertions like assert(true) or tests that don't actually exercise the real function's logic.
- Every assertion must test the ACTUAL behavior of the real code shown above, not assumed or invented behavior.

Output ONLY the complete test file content. Do not include any explanation, introduction, or markdown code fences. Output raw code only, starting from the first line of the file.`;
}

async function generateTestFile(params) {
  const prompt = buildTestGenerationPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false,
    options: { num_predict: 1500 }
  });

  return response.data.response;
}

function buildBlueprintPrompt(description) {
  return `Based on the following project requirements, produce a concise architecture blueprint.

Requirements:
${description}

Output ONLY a raw JSON object with exactly these fields, nothing else:
{
  "frontend": "short string naming the frontend technology",
  "backend": "short string naming the backend technology",
  "database": "short string naming the database technology",
  "authentication": "short string describing the auth approach",
  "storage": "short string describing file/media storage, or 'none' if not needed",
  "collections": ["list", "of", "main", "data", "entities", "or", "tables"],
  "modules": ["list", "of", "main", "functional", "modules", "or", "features"],
  "estimatedFiles": 20
}

The estimatedFiles field must be a realistic integer estimate of total files needed for a complete implementation, not a placeholder.

Do not wrap the JSON in markdown code fences. Do not include any explanation before or after the JSON.`;
}

async function generateBlueprint(description) {
  const prompt = buildBlueprintPrompt(description);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false,
    options: { num_predict: 1500 }
  });

  return response.data.response;
}

module.exports = {
  generateFileContent,
  generateFix,
  generateDocumentation,
  generatePlan,
  generateSelfReview,
  generateTestFile,
  buildGenerationPrompt,
  buildFixPrompt,
  buildDocumentationPrompt,
  buildPlanPrompt,
  buildSelfReviewPrompt,
  buildTestGenerationPrompt,
  buildClarifyingQuestionsPrompt,
  generateClarifyingQuestions,
  buildBlueprintPrompt,
  generateBlueprint
};
