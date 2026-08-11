const fs = require("fs");
const path = require("path");
const { sanitizeKeyPart } = require("./sessionKey");

const MAX_FACTS = 20;

function memoryPathFor(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");
  const filename = `${sanitizeKeyPart(studentId)}__${sanitizeKeyPart(projectName)}.json`;
  return path.join(__dirname, "memory", filename);
}

function loadMemory(sessionKey) {
  const memoryPath = memoryPathFor(sessionKey);
  if (!fs.existsSync(memoryPath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(memoryPath, "utf-8"));
  } catch (err) {
    console.error("[projectMemory] Failed to parse memory file, starting fresh:", err.message);
    return [];
  }
}

function saveMemory(sessionKey, facts) {
  const memoryPath = memoryPathFor(sessionKey);
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify(facts, null, 2));
}

function addFact(sessionKey, fact) {
  const facts = loadMemory(sessionKey);

  if (facts.includes(fact)) {
    return { added: false, reason: "Already remembered", facts };
  }

  facts.push(fact);

  while (facts.length > MAX_FACTS) {
    facts.shift();
  }

  saveMemory(sessionKey, facts);
  return { added: true, facts };
}

function getAllFacts(sessionKey) {
  return loadMemory(sessionKey);
}

function formatMemoryBlock(sessionKey) {
  const facts = loadMemory(sessionKey);
  if (facts.length === 0) {
    return "";
  }
  return `Project memory (persistent facts about this project):\n${facts.map((f) => `- ${f}`).join("\n")}\n\n`;
}

function clearMemory(sessionKey) {
  const memoryPath = memoryPathFor(sessionKey);

  if (!fs.existsSync(memoryPath)) {
    return false;
  }

  fs.unlinkSync(memoryPath);
  console.log(`[projectMemory] Deleted memory for ${sessionKey}`);
  return true;
}

module.exports = { addFact, getAllFacts, formatMemoryBlock, clearMemory };
