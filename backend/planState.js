const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { sanitizeKeyPart } = require("./sanitize");

const MAX_PLAN_FILES = 5; // shared cap for how many files a single plan batch may contain

const plans = new Map(); // sessionKey -> pending plan
const campaigns = new Map(); // sessionKey -> active campaign

// --- Disk persistence ---
//
// plans/campaigns previously lived only in memory, so a server restart
// silently wiped any in-flight plan or multi-batch campaign, even though
// the underlying project files, memory indexes, etc. all survive restarts.
// Each entry is persisted as its own JSON file (matching the pattern used
// by projectMemory.js / fileIndexer.js) and reloaded on module load.

const PLAN_STATE_DIR = path.join(__dirname, "memory", "planState");

function ensurePlanStateDir() {
  if (!fs.existsSync(PLAN_STATE_DIR)) {
    fs.mkdirSync(PLAN_STATE_DIR, { recursive: true });
  }
}

function fileKeyFor(sessionKey) {
  const [studentId, projectName] = sessionKey.split(":");
  return `${sanitizeKeyPart(studentId)}__${sanitizeKeyPart(projectName)}`;
}

function planFilePath(sessionKey) {
  return path.join(PLAN_STATE_DIR, `plan-${fileKeyFor(sessionKey)}.json`);
}

function campaignFilePath(sessionKey) {
  return path.join(PLAN_STATE_DIR, `campaign-${fileKeyFor(sessionKey)}.json`);
}

function persistPlan(sessionKey, plan) {
  ensurePlanStateDir();
  fs.writeFileSync(
    planFilePath(sessionKey),
    JSON.stringify({ sessionKey, plan }, null, 2)
  );
}

function removePersistedPlan(sessionKey) {
  const fp = planFilePath(sessionKey);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
  }
}

function persistCampaign(sessionKey, campaign) {
  ensurePlanStateDir();
  fs.writeFileSync(
    campaignFilePath(sessionKey),
    JSON.stringify({ sessionKey, campaign }, null, 2)
  );
}

function removePersistedCampaign(sessionKey) {
  const fp = campaignFilePath(sessionKey);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
  }
}

function loadPersistedState() {
  if (!fs.existsSync(PLAN_STATE_DIR)) {
    return;
  }

  for (const file of fs.readdirSync(PLAN_STATE_DIR)) {
    const filePath = path.join(PLAN_STATE_DIR, file);

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      if (file.startsWith("plan-") && parsed.sessionKey && parsed.plan) {
        plans.set(parsed.sessionKey, parsed.plan);
      } else if (file.startsWith("campaign-") && parsed.sessionKey && parsed.campaign) {
        campaigns.set(parsed.sessionKey, parsed.campaign);
      }
    } catch (err) {
      console.error(`[planState] Failed to load ${file}:`, err.message);
    }
  }

  if (plans.size > 0 || campaigns.size > 0) {
    console.log(
      `[planState] Restored ${plans.size} pending plan(s), ${campaigns.size} active campaign(s) from disk`
    );
  }
}

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
  persistPlan(sessionKey, plan);
  return plan;
}

function enrichWithDiffs(sessionKey, planId, enrichedFiles) {
  const plan = plans.get(sessionKey);
  if (!plan || plan.id !== planId) {
    return { success: false, reason: "No matching pending plan found" };
  }

  plan.files = enrichedFiles; // [{ path, description, before, after }]
  plan.stage = "diffs_proposed";

  persistPlan(sessionKey, plan);

  return { success: true, plan };
}

function clearPlan(sessionKey) {
  plans.delete(sessionKey);
  removePersistedPlan(sessionKey);
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
  persistCampaign(sessionKey, campaign);
  return campaign;
}

function recordBatchCompletion(sessionKey, campaignId, filePaths) {
  const campaign = campaigns.get(sessionKey);
  if (!campaign || campaign.id !== campaignId) {
    return { success: false, reason: "No matching active campaign found" };
  }

  campaign.completedFiles = campaign.completedFiles.concat(filePaths);
  campaign.batchNumber += 1;

  persistCampaign(sessionKey, campaign);

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

  persistCampaign(sessionKey, campaign);

  return {
    success: true,
    files: batch,
    remainingCount: campaign.remainingFiles.length
  };
}

function clearCampaign(sessionKey) {
  campaigns.delete(sessionKey);
  removePersistedCampaign(sessionKey);
}

loadPersistedState();

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
  clearCampaign,
  MAX_PLAN_FILES
};
