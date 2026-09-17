const crypto = require("crypto");
const { pool } = require("./db");
const { getOrCreateProjectId } = require("./projectResolver");

const MAX_PLAN_FILES = 5;

async function planRowToObject(row) {
  if (!row) return null;
  return {
    id: row.external_id,
    description: row.plan_data.description,
    files: row.plan_data.files,
    codeValidationIssues: row.plan_data.codeValidationIssues || [],
    stage: row.stage
  };
}

async function hasPendingPlan(sessionKey) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT 1 FROM plans WHERE project_id = $1 AND resolution IS NULL LIMIT 1",
    [projectId]
  );
  return rows.length > 0;
}

async function getPendingPlan(sessionKey) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT * FROM plans WHERE project_id = $1 AND resolution IS NULL LIMIT 1",
    [projectId]
  );
  return planRowToObject(rows[0]);
}

async function createPlan(sessionKey, { description, files }) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const externalId = crypto.randomBytes(8).toString("hex");

  await pool.query(
    `INSERT INTO plans (external_id, project_id, stage, plan_data)
     VALUES ($1, $2, 'plan_proposed', $3)`,
    [externalId, projectId, JSON.stringify({ description, files })]
  );

  return { id: externalId, description, files, codeValidationIssues: [], stage: "plan_proposed" };
}

async function enrichWithDiffs(sessionKey, planId, enrichedFiles, codeValidationIssues = []) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT * FROM plans WHERE project_id = $1 AND external_id = $2 AND resolution IS NULL",
    [projectId, planId]
  );

  if (rows.length === 0) {
    return { success: false, reason: "No matching pending plan found" };
  }

  const planData = {
    ...rows[0].plan_data,
    files: enrichedFiles,
    codeValidationIssues
  };

  const { rows: updated } = await pool.query(
    `UPDATE plans SET stage = 'diffs_proposed', plan_data = $1, updated_at = now()
     WHERE project_id = $2 AND external_id = $3
     RETURNING *`,
    [JSON.stringify(planData), projectId, planId]
  );

  return { success: true, plan: await planRowToObject(updated[0]) };
}

async function clearPlan(sessionKey, resolution = "rejected") {
  const projectId = await getOrCreateProjectId(sessionKey);
  await pool.query(
    `UPDATE plans SET resolution = $1, resolved_at = now(), updated_at = now()
     WHERE project_id = $2 AND resolution IS NULL`,
    [resolution, projectId]
  );
}

async function isValidPlanId(sessionKey, planId) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT 1 FROM plans WHERE project_id = $1 AND external_id = $2 AND resolution IS NULL LIMIT 1",
    [projectId, planId]
  );
  return rows.length > 0;
}

function campaignRowToObject(row) {
  if (!row) return null;
  return {
    id: row.external_id,
    description: row.description,
    completedFiles: row.completed_files,
    remainingFiles: row.remaining_files,
    batchNumber: row.batch_number
  };
}

async function hasActiveCampaign(sessionKey) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT 1 FROM plan_campaigns WHERE project_id = $1 AND resolution IS NULL LIMIT 1",
    [projectId]
  );
  return rows.length > 0;
}

async function getActiveCampaign(sessionKey) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT * FROM plan_campaigns WHERE project_id = $1 AND resolution IS NULL LIMIT 1",
    [projectId]
  );
  return campaignRowToObject(rows[0]);
}

async function startCampaign(sessionKey, { description, remainingFiles }) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const externalId = crypto.randomBytes(8).toString("hex");

  await pool.query(
    `INSERT INTO plan_campaigns (external_id, project_id, description, batch_number, completed_files, remaining_files)
     VALUES ($1, $2, $3, 1, '[]', $4)`,
    [externalId, projectId, description, JSON.stringify(remainingFiles)]
  );

  return { id: externalId, description, completedFiles: [], remainingFiles, batchNumber: 1 };
}

async function recordBatchCompletion(sessionKey, campaignId, filePaths) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT * FROM plan_campaigns WHERE project_id = $1 AND external_id = $2 AND resolution IS NULL",
    [projectId, campaignId]
  );

  if (rows.length === 0) {
    return { success: false, reason: "No matching active campaign found" };
  }

  const completedFiles = rows[0].completed_files.concat(filePaths);
  const batchNumber = rows[0].batch_number + 1;

  const { rows: updated } = await pool.query(
    `UPDATE plan_campaigns SET completed_files = $1, batch_number = $2, updated_at = now()
     WHERE project_id = $3 AND external_id = $4
     RETURNING *`,
    [JSON.stringify(completedFiles), batchNumber, projectId, campaignId]
  );

  return { success: true, campaign: campaignRowToObject(updated[0]) };
}

async function takeNextBatch(sessionKey, campaignId, maxFiles) {
  const projectId = await getOrCreateProjectId(sessionKey);
  const { rows } = await pool.query(
    "SELECT * FROM plan_campaigns WHERE project_id = $1 AND external_id = $2 AND resolution IS NULL",
    [projectId, campaignId]
  );

  if (rows.length === 0) {
    return { success: false, reason: "No matching active campaign found" };
  }

  const remaining = rows[0].remaining_files;
  const batch = remaining.slice(0, maxFiles);
  const newRemaining = remaining.slice(maxFiles);

  await pool.query(
    `UPDATE plan_campaigns SET remaining_files = $1, updated_at = now()
     WHERE project_id = $2 AND external_id = $3`,
    [JSON.stringify(newRemaining), projectId, campaignId]
  );

  return { success: true, files: batch, remainingCount: newRemaining.length };
}

async function clearCampaign(sessionKey, resolution = "completed", failureReason = null) {
  const projectId = await getOrCreateProjectId(sessionKey);
  await pool.query(
    `UPDATE plan_campaigns SET resolution = $1, failure_reason = $2, resolved_at = now(), updated_at = now()
     WHERE project_id = $3 AND resolution IS NULL`,
    [resolution, failureReason, projectId]
  );
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
  clearCampaign,
  MAX_PLAN_FILES
};
