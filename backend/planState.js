const crypto = require("crypto");

let pendingPlan = null;

function hasPendingPlan() {
  return pendingPlan !== null;
}

function getPendingPlan() {
  return pendingPlan;
}

function createPlan({ description, files }) {
  const id = crypto.randomBytes(8).toString("hex");

  pendingPlan = {
    id,
    description,
    files, // [{ path, description }]
    stage: "plan_proposed"
  };

  return pendingPlan;
}

function enrichWithDiffs(planId, enrichedFiles) {
  if (!pendingPlan || pendingPlan.id !== planId) {
    return { success: false, reason: "No matching pending plan found" };
  }

  pendingPlan.files = enrichedFiles; // [{ path, description, before, after }]
  pendingPlan.stage = "diffs_proposed";

  return { success: true, plan: pendingPlan };
}

function clearPlan() {
  pendingPlan = null;
}

function isValidPlanId(planId) {
  return pendingPlan !== null && pendingPlan.id === planId;
}

module.exports = {
  hasPendingPlan,
  getPendingPlan,
  createPlan,
  enrichWithDiffs,
  clearPlan,
  isValidPlanId
};
