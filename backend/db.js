const { Pool } = require("pg");

// Each student runs their own local Postgres, on their own device --
// no shared server. PGUSER/PGHOST/etc. let this be overridden if ever
// needed, but the default is just "whatever OS user is running this",
// which works out of the box on any device, not just one specific one.
const pool = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "taifa_ai",
  user: process.env.PGUSER || process.env.USER
});

pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle client:", err.message);
});

module.exports = { pool };
