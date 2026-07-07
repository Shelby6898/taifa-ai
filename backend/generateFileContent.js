const axios = require("axios");

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL_NAME = "qwen2.5-coder-6k";

function buildGenerationPrompt({ mode, targetPath, instruction, existingContent }) {
  if (mode === "edit" && existingContent) {
    return `You are editing an existing code file at path "${targetPath}".

Current file content:
${existingContent}

Instruction: ${instruction}

Output ONLY the complete updated file content. Do not include any explanation, comments about what you changed, or markdown code fences. Output raw code only, starting from the first line of the file.`;
  }

  return `You are creating a new code file at path "${targetPath}".

Instruction: ${instruction}

Output ONLY the complete file content. Do not include any explanation, introduction, or markdown code fences. Output raw code only, starting from the first line of the file.`;
}

function buildFixPrompt({ targetPath, errorText, existingContent }) {
  return `You are fixing a bug in an existing code file at path "${targetPath}".

Current file content:
${existingContent}

The following error occurred. Note: this error text may be condensed onto a single line rather than formatted as a multi-line stack trace — read it carefully to identify the actual error type and root cause regardless of formatting:

${errorText}

Before producing the fix, identify what specifically in the code above causes this error (for example: a missing null/undefined check, a missing required field, an incorrect variable reference, a type mismatch). The fix must make a REAL functional change that prevents this specific error from happening again — not just a cosmetic change like moving a comment or reformatting a line.

Output ONLY the complete fixed file content. Do not include any explanation of the bug, what you changed, or markdown code fences. Output raw code only, starting from the first line of the file. If the file content above does not appear to actually be the cause of this error, make your best reasonable attempt at a fix anyway.`;
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
The user wants: ${description}

Produce a plan as a JSON array. Each item must have exactly two fields:
- "path": a relative file path (e.g. "backend/routes/userRoutes.js")
- "description": one short sentence describing what this file should contain or how it should change

Rules:
- List ALL files this task genuinely needs to be complete, in priority order (most essential first). Do not artificially limit yourself to a small number — if the task needs 12 files, list all 12. A separate system will handle splitting this into batches, so your only job here is to think through the complete, real scope of the task.
- As a sanity bound, do not exceed 20 files even for a very large task — pick the 20 most essential if it seems larger than that.
- Reuse existing file paths from the project files shown above when the task means modifying something that already exists, rather than proposing a duplicate new file.
- Do not propose files unrelated to the user's request.

Output ONLY the raw JSON array. Do not wrap it in markdown code fences. Do not include any explanation before or after the JSON. Example format:
[{"path": "backend/example.js", "description": "Adds an example function"}]`;
}

async function generateFileContent(params) {
  const prompt = buildGenerationPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false
  });

  return response.data.response;
}

async function generateFix(params) {
  const prompt = buildFixPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false
  });

  return response.data.response;
}

async function generateDocumentation(params) {
  const prompt = buildDocumentationPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false
  });

  return response.data.response;
}

async function generatePlan(params) {
  const prompt = buildPlanPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false
  });

  return response.data.response;
}

function buildSelfReviewPrompt(code) {
  return `You are reviewing a code snippet. Most code you review will be completely fine — only answer YES if there is a specific, concrete, undeniable bug such as a reference to an undefined variable, a misspelled identifier, or a clear logic error. Do not invent a problem that is not really there.

Example 1:
Code: function double(x) { return x * 2; }
Answer: NO

Example 2:
Code: function greet(name) { return "Hello " + nam; }
Answer: YES: "nam" is misspelled and should be "name", which will cause a ReferenceError.

Now review this code:
${code}

Answer in exactly this format, nothing else:
NO
or
YES: <one short sentence describing the specific problem>`;
}

async function generateSelfReview(code) {
  const prompt = buildSelfReviewPrompt(code);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false
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
    stream: false
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
  buildTestGenerationPrompt
};
