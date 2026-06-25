const fs = require("fs");
const path = require("path");

const MEMORY_PATH = path.join(__dirname, "memory", "projectMemory.json");
const MAX_FACTS = 20;

function loadMemory() {
  if (!fs.existsSync(MEMORY_PATH)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(MEMORY_PATH, "utf-8"));
  } catch (err) {
    console.error("[projectMemory] Failed to parse memory file, starting fresh:", err.message);
    return [];
  }
}

function saveMemory(facts) {
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(facts, null, 2));
}

function addFact(fact) {
  const facts = loadMemory();

  // Avoid storing an exact duplicate of something already remembered
  if (facts.includes(fact)) {
    return { added: false, reason: "Already remembered", facts };
  }

  facts.push(fact);

  // Cap total facts — if we exceed the limit, drop the OLDEST one.
  // This is a simple, predictable eviction policy: oldest-first,
  // not "most/least important" (which would require judgment calls
  // we don't want a small model making automatically).
  while (facts.length > MAX_FACTS) {
    facts.shift();
  }

  saveMemory(facts);
  return { added: true, facts };
}

function getAllFacts() {
  return loadMemory();
}

function formatMemoryBlock() {
  const facts = loadMemory();
  if (facts.length === 0) {
    return "";
  }
  return `Project memory (persistent facts about this project):\n${facts.map((f) => `- ${f}`).join("\n")}\n\n`;
}

module.exports = { addFact, getAllFacts, formatMemoryBlock };
