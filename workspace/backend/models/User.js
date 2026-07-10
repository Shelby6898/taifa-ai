const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Simple in-memory user store for local testing. NOT persistent —
// data is lost on server restart. Real projects should replace this
// with an actual database (e.g. Firestore, matching this project's
// established production pattern).

const users = [];
const SALT_ROUNDS = 10;

async function create({ username, email, password, role }) {
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

  const user = {
    _id: crypto.randomUUID(),
    username,
    email,
    password: hashedPassword,
    role: role || 'user'
  };

  users.push(user);

  // Never return the password hash to callers — this is the object
  // that gets sent straight back to the client in the register response.
  const { password: _omit, ...safeUser } = user;
  return safeUser;
}

// Returns the full stored record, including the password hash — the
// caller (login route) needs it to run bcrypt.compare(). It is the
// caller's responsibility to never send this raw record back to a client.
async function findOne(query) {
  return users.find((u) =>
    Object.keys(query).every((key) => u[key] === query[key])
  ) || null;
}

module.exports = { create, findOne };
