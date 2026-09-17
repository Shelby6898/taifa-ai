const { Pool } = require("pg");

const pool = new Pool({
  host: "127.0.0.1",
  port: 5432,
  database: "taifa_ai",
  user: process.env.USER || "u0_a398"
});

pool.on("error", (err) => {
  console.error("[db] Unexpected error on idle client:", err.message);
});

module.exports = { pool };
