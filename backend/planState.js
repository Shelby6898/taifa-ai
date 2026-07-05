const crypto = require("crypto");

let pendingPlan = null;
let activeCampaign = null;

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

// --- Campaign tracking for multi-batch plans ---
//
// A campaign stores the actual remaining files (with their descriptions)
// that didn't fit in the first batch. Continuation batches are pulled
// mechanically from this list rather than asking the model to re-derive
// what's left — testing showed the model does not reliably honor a
// "these files are already done, don't repeat them" instruction, so
// tracking the real remaining list deterministically is more reliable
// than trusting the model to reconstruct it from context.

function hasActiveCampaign() {
  return activeCampaign !== null;
}

function getActiveCampaign() {
  return activeCampaign;
}

function startCampaign({ description, remainingFiles }) {
  const id = crypto.randomBytes(8).toString("hex");

  activeCampaign = {
    id,
    description,
    completedFiles: [], // flat list of paths written so far, for record-keeping
    remainingFiles, // [{ path, description }] not yet batched
    batchNumber: 1,
    status: "active"
  };

  return activeCampaign;
}

function recordBatchCompletion(campaignId, filePaths) {
  if (!activeCampaign || activeCampaign.id !== campaignId) {
    return { success: false, reason: "No matching active campaign found" };
  }

  activeCampaign.completedFiles = activeCampaign.completedFiles.concat(filePaths);
  activeCampaign.batchNumber += 1;

  return { success: true, campaign: activeCampaign };
}

// Pulls up to maxFiles from the campaign's remaining queue, removing
// them from it. Returns the batch and how many files are still left
// after this batch — an empty batch means the campaign is complete.
function takeNextBatch(campaignId, maxFiles) {
  if (!activeCampaign || activeCampaign.id !== campaignId) {
    return { success: false, reason: "No matching active campaign found" };
  }

  const batch = activeCampaign.remainingFiles.slice(0, maxFiles);
  activeCampaign.remainingFiles = activeCampaign.remainingFiles.slice(maxFiles);

  return {
    success: true,
    files: batch,
    remainingCount: activeCampaign.remainingFiles.length
  };
}

function clearCampaign() {
  activeCampaign = null;
}

module.exports = {
  hasPendingPlan,
  getPendingPlan,
  createPlan,
  enrichWithDiffs,
  clearPlan,
  isValidPlanId,
  hasActiveCampaign,
  getActiveCampaign,
  startCampaign,
  recordBatchCompletion,
  takeNextBatch,
  clearCampaign
};
