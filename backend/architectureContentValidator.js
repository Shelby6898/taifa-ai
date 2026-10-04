const {
  getArchitectureTerms,
  detectDatabaseFamily,
} = require("./architectureContract");

const DATABASE_IMPLEMENTATION_PATTERNS = {
  postgresql: [
    /\brequire\s*\(\s*["']pg["']\s*\)/i,
    /from\s+["']pg["']/i,
    /\bnew\s+Pool\s*\(/i,
    /\bPool\s*\(/i,
    /\.query\s*\(/i,
  ],

  mysql: [
    /\brequire\s*\(\s*["']mysql["']\s*\)/i,
    /from\s+["']mysql["']/i,
    /\bmysql2?\b/i,
    /\bcreatePool\s*\(/i,
  ],

  sqlite: [
    /\brequire\s*\(\s*["'](?:better-sqlite3|sqlite3)["']\s*\)/i,
    /from\s+["'](?:better-sqlite3|sqlite3)["']/i,
    /\bnew\s+Database\s*\(/i,
  ],

  mongodb: [
    /\brequire\s*\(\s*["']mongodb["']\s*\)/i,
    /from\s+["']mongodb["']/i,
    /\bMongoClient\b/i,
    /\bmongoose\b/i,
    /\bmongoose\s*\.\s*(?:connect|model|Schema)\s*\(/i,
  ],

  firestore: [
    /\bfirebase-admin\/firestore\b/i,
    /\bgetFirestore\s*\(/i,
    /\binitializeApp\s*\(/i,
    /\bfirestore\s*\(\s*\)/i,
    /\.\s*collection\s*\(/i,
    /\.\s*doc\s*\(/i,
  ],
};

const DATABASE_ALIASES = {
  postgresql: ["postgresql", "postgres"],
  mysql: ["mysql", "mariadb"],
  sqlite: ["sqlite"],
  mongodb: ["mongodb", "mongo", "mongoose"],
  firestore: ["firestore", "firebase"],
};

function normalizeDatabaseIdentity(database) {
  const name = String(database || "").trim().toLowerCase();

  for (const [identity, aliases] of Object.entries(DATABASE_ALIASES)) {
    if (aliases.some((alias) => name.includes(alias))) {
      return identity;
    }
  }

  return null;
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function detectDatabaseImplementation(content) {
  const code = stripComments(content);
  const matches = [];

  for (const [database, patterns] of Object.entries(DATABASE_IMPLEMENTATION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(code)) {
        matches.push(database);
        break;
      }
    }
  }

  return [...new Set(matches)];
}


function validateGeneratedContent(content, architecture) {
  const issues = [];

  if (!architecture) {
    return issues;
  }

  if (!content || typeof content !== "string") {
    issues.push({
      type: "architecture_content_invalid",
      detail: "Generated content is missing or is not a string.",
    });

    return issues;
  }

  if (!architecture.database) {
    issues.push({
      type: "architecture_content_invalid",
      detail: "Confirmed architecture does not specify a database.",
    });

    return issues;
  }

  const expectedDatabase = normalizeDatabaseIdentity(
    architecture.database
  );

  if (!expectedDatabase) {
    return issues;
  }

  const detectedDatabases = detectDatabaseImplementation(content);

  /*
   * Comments are intentionally removed by detectDatabaseImplementation().
   *
   * Therefore:
   *
   *   // MongoDB
   *
   * does not count as MongoDB implementation.
   *
   * But:
   *
   *   const { MongoClient } = require("mongodb");
   *
   * does count.
   */

  if (detectedDatabases.length === 0) {
    return issues;
  }

  const incompatibleDatabases = detectedDatabases.filter(
    (database) => database !== expectedDatabase
  );

  if (incompatibleDatabases.length > 0) {
    issues.push({
      type: "architecture_drift",
      family:
        architecture.databaseFamily ||
        detectDatabaseFamily(architecture.database),
      database: architecture.database,
      expectedDatabase,
      detectedDatabases,
      incompatibleDatabases,
      detail:
        `Generated content contains an implementation incompatible ` +
        `with the confirmed database (${architecture.database}). ` +
        `Detected: ${detectedDatabases.join(", ")}.`,
    });
  }

  return issues;
}

function assertGeneratedContentMatchesArchitecture(content, architecture) {
  const issues = validateGeneratedContent(content, architecture);

  if (issues.length > 0) {
    const error = new Error(
      `Generated content violates confirmed architecture:\n` +
        issues.map((i) => `- ${i.detail}`).join("\n")
    );

    error.code = "ARCHITECTURE_DRIFT";
    error.issues = issues;

    throw error;
  }

  return {
    valid: true,
    issues: [],
  };
}

module.exports = {
  stripComments,
  validateGeneratedContent,
  assertGeneratedContentMatchesArchitecture,
};
