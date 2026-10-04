const assert = require("assert");

const {
  stripComments,
  validateGeneratedContent,
  assertGeneratedContentMatchesArchitecture,
} = require("./architectureContentValidator");

const postgresArchitecture = {
  version: 1,
  frontend: "React",
  backend: "Express",
  database: "PostgreSQL",
  databaseFamily: "sql",
  authentication: "JWT",
  entities: ["User", "Property"],
  deployment: "Railway",
  estimatedFiles: 10,
};

const mongoArchitecture = {
  version: 1,
  frontend: "React",
  backend: "Express",
  database: "MongoDB",
  databaseFamily: "nosql",
  authentication: "JWT",
  entities: ["User", "Property"],
  deployment: "Railway",
  estimatedFiles: 10,
};

const firestoreArchitecture = {
  version: 1,
  frontend: "React",
  backend: "Express",
  database: "Firestore",
  databaseFamily: "nosql",
  authentication: "Firebase Auth",
  entities: ["User", "Property"],
  deployment: "Firebase",
  estimatedFiles: 10,
};

const validPostgresCode = `
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function findUsers() {
  const result = await pool.query(
    "SELECT id, email FROM users"
  );

  return result.rows;
}

module.exports = { findUsers };
`;

const validMongoCode = `
const mongoose = require("mongoose");

const User = mongoose.model(
  "User",
  new mongoose.Schema({
    email: String
  })
);

async function findUsers() {
  return User.find({});
}

module.exports = { findUsers };
`;

const validFirestoreCode = `
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

admin.initializeApp();

const db = getFirestore();

async function findUsers() {
  const snapshot = await db
    .collection("users")
    .get();

  return snapshot.docs.map(doc => doc.data());
}

module.exports = { findUsers };
`;

const driftingFirestoreCode = `
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const db = getFirestore();

async function findUsers() {
  const snapshot = await db
    .collection("users")
    .get();

  return snapshot.docs.map(doc => doc.data());
}

module.exports = { findUsers };
`;

const driftingMongoCode = `
const mongoose = require("mongoose");

const User = mongoose.model("User");

module.exports = User;
`;

const driftingPostgresCode = `
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function findUsers() {
  const result = await pool.query(
    "SELECT id, email FROM users"
  );

  return result.rows;
}

module.exports = { findUsers };
`;

console.log("Test 1: valid PostgreSQL implementation should pass");

let issues = validateGeneratedContent(
  validPostgresCode,
  postgresArchitecture
);

assert.strictEqual(
  issues.length,
  0,
  `Valid PostgreSQL code was rejected: ${JSON.stringify(issues)}`
);

assert.doesNotThrow(() => {
  assertGeneratedContentMatchesArchitecture(
    validPostgresCode,
    postgresArchitecture
  );
});

console.log("PASS");

console.log("Test 2: valid MongoDB implementation should pass");

issues = validateGeneratedContent(
  validMongoCode,
  mongoArchitecture
);

assert.strictEqual(
  issues.length,
  0,
  `Valid MongoDB code was rejected: ${JSON.stringify(issues)}`
);

assert.doesNotThrow(() => {
  assertGeneratedContentMatchesArchitecture(
    validMongoCode,
    mongoArchitecture
  );
});

console.log("PASS");

console.log("Test 3: valid Firestore implementation should pass");

issues = validateGeneratedContent(
  validFirestoreCode,
  firestoreArchitecture
);

assert.strictEqual(
  issues.length,
  0,
  `Valid Firestore code was rejected: ${JSON.stringify(issues)}`
);

assert.doesNotThrow(() => {
  assertGeneratedContentMatchesArchitecture(
    validFirestoreCode,
    firestoreArchitecture
  );
});

console.log("PASS");

console.log("Test 4: PostgreSQL architecture must reject Firestore drift");

issues = validateGeneratedContent(
  driftingFirestoreCode,
  postgresArchitecture
);

assert.ok(
  issues.length > 0,
  "Firestore drift was NOT detected"
);

assert.throws(
  () => {
    assertGeneratedContentMatchesArchitecture(
      driftingFirestoreCode,
      postgresArchitecture
    );
  },
  (error) => error.code === "ARCHITECTURE_DRIFT"
);

console.log("PASS");

console.log("Test 5: PostgreSQL architecture must reject MongoDB drift");

issues = validateGeneratedContent(
  driftingMongoCode,
  postgresArchitecture
);

assert.ok(
  issues.length > 0,
  "MongoDB drift was NOT detected"
);

assert.throws(
  () => {
    assertGeneratedContentMatchesArchitecture(
      driftingMongoCode,
      postgresArchitecture
    );
  },
  (error) => error.code === "ARCHITECTURE_DRIFT"
);

console.log("PASS");

console.log("Test 6: PostgreSQL architecture must reject MongoDB implementation");

issues = validateGeneratedContent(
  driftingMongoCode,
  postgresArchitecture
);

assert.ok(
  issues.some((issue) => issue.type === "architecture_drift"),
  "MongoDB implementation was not detected as PostgreSQL architecture drift"
);

console.log("PASS");

console.log("Test 7: MongoDB architecture must reject PostgreSQL implementation");

issues = validateGeneratedContent(
  driftingPostgresCode,
  mongoArchitecture
);

assert.ok(
  issues.length > 0,
  "PostgreSQL drift was NOT detected in MongoDB architecture"
);

assert.throws(
  () => {
    assertGeneratedContentMatchesArchitecture(
      driftingPostgresCode,
      mongoArchitecture
    );
  },
  (error) => error.code === "ARCHITECTURE_DRIFT"
);

console.log("PASS");

console.log(
  "Test 8: PostgreSQL architecture + MongoDB line comment should PASS"
);

const postgresWithMongoComment = `
// Previous version of this application used MongoDB.
// MongoDB collections were replaced during migration.

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function findUsers() {
  const result = await pool.query(
    "SELECT id, email FROM users"
  );

  return result.rows;
}
`;

issues = validateGeneratedContent(
  postgresWithMongoComment,
  postgresArchitecture
);

assert.strictEqual(
  issues.length,
  0,
  `MongoDB comment incorrectly triggered drift: ${JSON.stringify(issues)}`
);

console.log("PASS");

console.log(
  "Test 9: PostgreSQL architecture + MongoDB block comment should PASS"
);

const postgresWithMongoBlockComment = `
/*
  Migration note:
  MongoDB was previously considered.
  Firestore was also evaluated.
*/

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function findUsers() {
  return pool.query("SELECT * FROM users");
}
`;

issues = validateGeneratedContent(
  postgresWithMongoBlockComment,
  postgresArchitecture
);

assert.strictEqual(
  issues.length,
  0,
  `Database names inside comments incorrectly triggered drift: ${JSON.stringify(
    issues
  )}`
);

console.log("PASS");

console.log(
  "Test 10: actual MongoDB code inside PostgreSQL architecture must still FAIL"
);

const postgresWithActualMongoCode = `
// MongoDB comment should be ignored.

const mongoose = require("mongoose");

const User = mongoose.model("User");

module.exports = User;
`;

issues = validateGeneratedContent(
  postgresWithActualMongoCode,
  postgresArchitecture
);

assert.ok(
  issues.length > 0,
  "Actual MongoDB implementation was incorrectly accepted"
);

console.log("PASS");

console.log("Test 11: stripComments removes line comments");

const strippedLineComment = stripComments(
  `
  // MongoDB should disappear
  const value = "PostgreSQL";
  `
);

assert.ok(
  !strippedLineComment.includes("MongoDB should disappear"),
  "Line comment was not removed"
);

assert.ok(
  strippedLineComment.includes('const value = "PostgreSQL";'),
  "Executable/string content was unexpectedly removed"
);

console.log("PASS");

console.log("Test 12: stripComments removes block comments");

const strippedBlockComment = stripComments(
  `
  /*
    MongoDB
    Firestore
    PostgreSQL
  */

  const value = 42;
  `
);

assert.ok(
  !strippedBlockComment.includes("MongoDB"),
  "MongoDB block comment was not removed"
);

assert.ok(
  !strippedBlockComment.includes("Firestore"),
  "Firestore block comment was not removed"
);

assert.ok(
  strippedBlockComment.includes("const value = 42;"),
  "Executable content was unexpectedly removed"
);

console.log("PASS");

console.log("");
console.log(
  "Architecture content validator regression tests: ALL PASSED"
);
