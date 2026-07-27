const crypto = require("crypto");

const actions = new Map(); // sessionKey -> pending action

function hasPendingAction(sessionKey) {
  return actions.has(sessionKey);
}

function getPendingAction(sessionKey) {
  return actions.get(sessionKey) || null;
}

function createPendingAction(sessionKey, { type, payload }) {
  const id = crypto.randomBytes(8).toString("hex");
  const action = { id, type, payload };
  actions.set(sessionKey, action);
  return action;
}

function isValidActionId(sessionKey, id) {
  const action = actions.get(sessionKey);
  return action !== undefined && action.id === id;
}

function clearPendingAction(sessionKey) {
  actions.delete(sessionKey);
}

module.exports = {
  hasPendingAction,
  getPendingAction,
  createPendingAction,
  isValidActionId,
  clearPendingAction
};
