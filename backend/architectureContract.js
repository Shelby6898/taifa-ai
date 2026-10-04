const SQL_DATABASES = [
  "postgresql",
  "postgres",
  "mysql",
  "mariadb",
  "sqlite",
  "sql server",
  "mssql",
];

const NOSQL_DATABASES = [
  "mongodb",
  "mongo",
  "firestore",
  "dynamodb",
  "couchdb",
  "cassandra",
];

function normalizeDatabaseName(value) {
  return String(value || "").trim();
}

function detectDatabaseFamily(database) {
  const name = normalizeDatabaseName(database).toLowerCase();

  if (SQL_DATABASES.some((db) => name.includes(db))) {
    return "sql";
  }

  if (NOSQL_DATABASES.some((db) => name.includes(db))) {
    return "nosql";
  }

  return "unknown";
}

function buildTerminology(database, family) {
  if (family === "sql") {
    return {
      database: database,
      family: "sql",

      schemaContainer: "table",
      schemaContainers: "tables",

      record: "row",
      records: "rows",

      field: "column",
      fields: "columns",

      relationship: "foreign key relationship",
      relationships: "foreign key relationships",

      persistence: "database",
      query: "SQL query",
      model: "model",
    };
  }

  if (family === "nosql") {
    return {
      database: database,
      family: "nosql",

      schemaContainer: "collection",
      schemaContainers: "collections",

      record: "document",
      records: "documents",

      field: "field",
      fields: "fields",

      relationship: "document relationship",
      relationships: "document relationships",

      persistence: "database",
      query: "database query",
      model: "document model",
    };
  }

  return {
    database: database,
    family: "unknown",

    schemaContainer: "data structure",
    schemaContainers: "data structures",

    record: "record",
    records: "records",

    field: "field",
    fields: "fields",

    relationship: "relationship",
    relationships: "relationships",

    persistence: "database",
    query: "database query",
    model: "data model",
  };
}

function normalizeEntities(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entity) => String(entity).trim())
    .filter(Boolean);
}

function normalizeArchitecture(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Architecture must be an object");
  }

  const database = normalizeDatabaseName(raw.database);

  if (!database) {
    throw new Error("Architecture must specify a database");
  }

  const family = detectDatabaseFamily(database);

  return {
    version: 1,

    frontend: raw.frontend || null,
    backend: raw.backend || null,
    database,
    databaseFamily: family,

    authentication: raw.authentication || null,

    entities: normalizeEntities(
      Array.isArray(raw.entities)
        ? raw.entities
        : raw.collections
    ),

    deployment: raw.deployment || null,

    estimatedFiles:
      Number.isInteger(raw.estimatedFiles)
        ? raw.estimatedFiles
        : null,

    terminology: buildTerminology(database, family),
  };
}

function validateArchitectureContract(architecture) {
  const issues = [];

  if (!architecture || typeof architecture !== "object") {
    issues.push("Architecture is missing.");
    return issues;
  }

  if (!architecture.database) {
    issues.push("Architecture database is missing.");
  }

  if (!["sql", "nosql", "unknown"].includes(architecture.databaseFamily)) {
    issues.push(
      `Invalid database family: ${architecture.databaseFamily}`
    );
  }

  if (!architecture.terminology) {
    issues.push("Architecture terminology is missing.");
  }

  if (!Array.isArray(architecture.entities)) {
    issues.push("Architecture entities must be an array.");
  }

  return issues;
}

function getArchitectureTerms(architecture) {
  if (!architecture) return null;

  if (architecture.terminology) {
    return architecture.terminology;
  }

  return buildTerminology(
    architecture.database,
    architecture.databaseFamily ||
      detectDatabaseFamily(architecture.database)
  );
}

module.exports = {
  SQL_DATABASES,
  NOSQL_DATABASES,
  detectDatabaseFamily,
  buildTerminology,
  normalizeArchitecture,
  getArchitectureTerms,
  validateArchitectureContract,
};
