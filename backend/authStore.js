const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const DB_PATH = path.join(__dirname, "data", "users.json");
const SALT_ROUNDS = 10;

function loadUsers() {
  if (!fs.existsSync(DB_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(users, null, 2));
}

async function create({ username, password }) {
  const users = loadUsers();
  if (users.find((u) => u.username === username)) {
    throw new Error("Username already exists");
  }
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { _id: crypto.randomUUID(), username, password: hashedPassword };
  users.push(user);
  saveUsers(users);
  const { password: _omit, ...safeUser } = user;
  return safeUser;
}

async function findOne({ username }) {
  const users = loadUsers();
  return users.find((u) => u.username === username) || null;
}

module.exports = { create, findOne };
