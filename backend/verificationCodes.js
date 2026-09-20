const crypto = require("crypto");

const CODE_TTL_MS = 10 * 60 * 1000;
const pendingCodes = new Map();

function generateCode(email) {
  const code = crypto.randomInt(100000, 1000000).toString();
  pendingCodes.set(email, { code, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

function verifyCode(email, submittedCode) {
  const entry = pendingCodes.get(email);
  pendingCodes.delete(email);

  if (!entry) {
    return { valid: false, reason: "No verification code was requested for this email, or it has already been used." };
  }
  if (Date.now() > entry.expiresAt) {
    return { valid: false, reason: "Verification code has expired. Request a new one." };
  }
  if (entry.code !== submittedCode) {
    return { valid: false, reason: "Incorrect verification code." };
  }
  return { valid: true };
}

module.exports = { generateCode, verifyCode };
