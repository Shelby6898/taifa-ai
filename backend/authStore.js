const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "data", "users.json");
const SALT_ROUNDS = 10;

function loadUsers() {
  if (!fs.existsSync(DB_PATH)) return [];

  const users = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  if (!Array.isArray(users)) {
    throw new Error("Account database has an invalid format");
  }
  return users;
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const tempPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(users, null, 2), {
    mode: 0o600
  });
  fs.renameSync(tempPath, DB_PATH);
}

function safeUser(user) {
  if (!user) return null;
  const { password, ...result } = user;
  return result;
}

async function create({ username, password }) {
  const users = loadUsers();
  const normalized = username.trim();

  if (users.some(u => u.username.toLowerCase() === normalized.toLowerCase())) {
    throw new Error("Username already exists");
  }

  const user = {
    _id: crypto.randomUUID(),
    username: normalized,
    password: await bcrypt.hash(password, SALT_ROUNDS)
  };

  users.push(user);
  saveUsers(users);
  return safeUser(user);
}

async function findOne({ username }) {
  const users = loadUsers();
  const normalized = username.trim().toLowerCase();

  return users.find(
    u => typeof u.username === "string" &&
         u.username.toLowerCase() === normalized
  ) || null;
}

function findById(userId) {
  return loadUsers().find(u => u._id === userId) || null;
}

async function changeUsername(userId, currentPassword, newUsername) {
  const users = loadUsers();
  const user = users.find(u => u._id === userId);

  if (!user) throw new Error("Account not found");

  const matches = await bcrypt.compare(currentPassword, user.password || "");
  if (!matches) throw new Error("Current password is incorrect");

  const normalized = newUsername.trim();
  const duplicate = users.some(
    u => u._id !== userId &&
         u.username.toLowerCase() === normalized.toLowerCase()
  );

  if (duplicate) throw new Error("Username already exists");

  user.username = normalized;
  saveUsers(users);
  return safeUser(user);
}

async function changePassword(userId, currentPassword, newPassword) {
  const users = loadUsers();
  const user = users.find(u => u._id === userId);

  if (!user) throw new Error("Account not found");

  const matches = await bcrypt.compare(currentPassword, user.password || "");
  if (!matches) throw new Error("Current password is incorrect");

  user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  saveUsers(users);
  return safeUser(user);
}

module.exports = {
  create,
  findOne,
  findById,
  changeUsername,
  changePassword
};
