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

// Called only after email verification has already succeeded (the
// register route checks the code before ever calling this), so a user
// created here is verified by definition -- there's no unverified
// state to represent in this store.
async function create({ username, password }) {
  const users = loadUsers();
  if (users.find((u) => u.username === username)) {
    throw new Error("Username already exists");
  }
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  const user = { _id: crypto.randomUUID(), username, password: hashedPassword, verified: true, googleId: null };
  users.push(user);
  saveUsers(users);
  const { password: _omit, ...safeUser } = user;
  return safeUser;
}

async function findOne({ username }) {
  const users = loadUsers();
  return users.find((u) => u.username === username) || null;
}

async function findOneByGoogleId(googleId) {
  const users = loadUsers();
  return users.find((u) => u.googleId === googleId) || null;
}

// Handles three cases: a returning Google user (found by googleId,
// returned as-is); a user who previously registered with email/password
// and is now using Google sign-in for the first time with the same
// email (found by username match, googleId linked onto the existing
// record rather than creating a duplicate account); or a genuinely new
// user (created fresh, no password since Google is the only way in).
async function linkOrCreateGoogleUser({ googleId, email }) {
  const users = loadUsers();

  let user = users.find((u) => u.googleId === googleId);
  if (user) {
    const { password: _omit, ...safeUser } = user;
    return safeUser;
  }

  user = users.find((u) => u.username === email);
  if (user) {
    user.googleId = googleId;
    saveUsers(users);
    const { password: _omit, ...safeUser } = user;
    return safeUser;
  }

  const newUser = { _id: crypto.randomUUID(), username: email, password: null, verified: true, googleId };
  users.push(newUser);
  saveUsers(users);
  const { password: _omit, ...safeUser } = newUser;
  return safeUser;
}

// Used only by the reset-password flow, which has already verified
// the reset token (and thus the user's control of that email) before
// this is ever called -- no current password is checked here, since
// proving the token is the whole point of "forgot" password.
async function updatePassword(username, newPassword) {
  const users = loadUsers();
  const user = users.find((u) => u.username === username);
  if (!user) {
    throw new Error("No account found for this email");
  }
  user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
  saveUsers(users);
}

module.exports = { create, findOne, findOneByGoogleId, linkOrCreateGoogleUser, updatePassword };
