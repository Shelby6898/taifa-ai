const crypto = require("crypto");

let pendingAction = null;

function hasPendingAction() {
  return pendingAction !== null;
}

function getPendingAction() {
  return pendingAction;
}

function createPendingAction({ type, payload }) {
  const id = crypto.randomBytes(8).toString("hex");
  pendingAction = { id, type, payload };
  return pendingAction;
}

function isValidActionId(id) {
  return pendingAction !== null && pendingAction.id === id;
}

function clearPendingAction() {
  pendingAction = null;
}

module.exports = {
  hasPendingAction,
  getPendingAction,
  createPendingAction,
  isValidActionId,
  clearPendingAction
};
