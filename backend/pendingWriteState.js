const crypto = require("crypto");

const writes = new Map(); // sessionKey -> pending write proposal

function hasPendingWrite(sessionKey) {
  return writes.has(sessionKey);
}

function getPendingWrite(sessionKey) {
  return writes.get(sessionKey) || null;
}

function createPendingWrite(sessionKey, data) {
  const id = crypto.randomBytes(8).toString("hex");
  const write = { id, ...data };
  writes.set(sessionKey, write);
  return write;
}

function clearPendingWrite(sessionKey) {
  writes.delete(sessionKey);
}

module.exports = { hasPendingWrite, getPendingWrite, createPendingWrite, clearPendingWrite };
