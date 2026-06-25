const axios = require("axios");

const OLLAMA_URL = "http://127.0.0.1:11434";
const MODEL_NAME = "qwen2.5-coder:1.5b";

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

async function generateFileContent(params) {
  const prompt = buildGenerationPrompt(params);

  const response = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: MODEL_NAME,
    prompt,
    stream: false
  });

  return response.data.response;
}

module.exports = { generateFileContent, buildGenerationPrompt };
