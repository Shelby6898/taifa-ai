const crypto = require("crypto");

const TOKEN_TTL_MS = 30 * 60 * 1000;
const pendingTokens = new Map();

function generateToken(email) {
  const token = crypto.randomBytes(32).toString("hex");
  pendingTokens.set(token, { email, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function verifyToken(token) {
  const entry = pendingTokens.get(token);
  pendingTokens.delete(token);

  if (!entry) {
    return { valid: false, reason: "This reset link is invalid or has already been used." };
  }
  if (Date.now() > entry.expiresAt) {
    return { valid: false, reason: "This reset link has expired. Request a new one." };
  }
  return { valid: true, email: entry.email };
}

module.exports = { generateToken, verifyToken };
