const crypto = require("crypto");

const plans = new Map(); // sessionKey -> pending plan
const campaigns = new Map(); // sessionKey -> active campaign

function hasPendingPlan(sessionKey) {
  return plans.has(sessionKey);
}

function getPendingPlan(sessionKey) {
  return plans.get(sessionKey) || null;
}

function createPlan(sessionKey, { description, files }) {
  const id = crypto.randomBytes(8).toString("hex");

  const plan = {
    id,
    description,
    files, // [{ path, description }]
    stage: "plan_proposed"
  };

  plans.set(sessionKey, plan);
  return plan;
}

function enrichWithDiffs(sessionKey, planId, enrichedFiles) {
  const plan = plans.get(sessionKey);
  if (!plan || plan.id !== planId) {
    return { success: false, reason: "No matching pending plan found" };
  }

  plan.files = enrichedFiles; // [{ path, description, before, after }]
  plan.stage = "diffs_proposed";

  return { success: true, plan };
}

function clearPlan(sessionKey) {
  plans.delete(sessionKey);
}

function isValidPlanId(sessionKey, planId) {
  const plan = plans.get(sessionKey);
  return plan !== undefined && plan.id === planId;
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

function hasActiveCampaign(sessionKey) {
  return campaigns.has(sessionKey);
}

function getActiveCampaign(sessionKey) {
  return campaigns.get(sessionKey) || null;
}

function startCampaign(sessionKey, { description, remainingFiles }) {
  const id = crypto.randomBytes(8).toString("hex");

  const campaign = {
    id,
    description,
    completedFiles: [], // flat list of paths written so far, for record-keeping
    remainingFiles, // [{ path, description }] not yet batched
    batchNumber: 1,
    status: "active"
  };

  campaigns.set(sessionKey, campaign);
  return campaign;
}

function recordBatchCompletion(sessionKey, campaignId, filePaths) {
  const campaign = campaigns.get(sessionKey);
  if (!campaign || campaign.id !== campaignId) {
    return { success: false, reason: "No matching active campaign found" };
  }

  campaign.completedFiles = campaign.completedFiles.concat(filePaths);
  campaign.batchNumber += 1;

  return { success: true, campaign };
}

// Pulls up to maxFiles from the campaign's remaining queue, removing
// them from it. Returns the batch and how many files are still left
// after this batch — an empty batch means the campaign is complete.
function takeNextBatch(sessionKey, campaignId, maxFiles) {
  const campaign = campaigns.get(sessionKey);
  if (!campaign || campaign.id !== campaignId) {
    return { success: false, reason: "No matching active campaign found" };
  }

  const batch = campaign.remainingFiles.slice(0, maxFiles);
  campaign.remainingFiles = campaign.remainingFiles.slice(maxFiles);

  return {
    success: true,
    files: batch,
    remainingCount: campaign.remainingFiles.length
  };
}

function clearCampaign(sessionKey) {
  campaigns.delete(sessionKey);
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
