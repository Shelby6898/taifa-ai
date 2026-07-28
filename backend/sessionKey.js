const { sanitizeKeyPart } = require("./sanitize");
const { ensureWatching } = require("./fileIndexer");

function getSessionKey(req) {
  // GET requests can't carry a body in the browser's fetch API, so
  // projectName may arrive as a query param instead — body takes
  // priority when both are present (shouldn't normally happen).
  const rawProjectName = (req.body && req.body.projectName) || req.query.projectName;

  const studentId = sanitizeKeyPart(req.userId);
  const projectName = sanitizeKeyPart(rawProjectName);
  const sessionKey = `${studentId}:${projectName}`;

  // Every request that resolves a session key also ensures that
  // session's watcher is alive (creating it on first use, or just
  // refreshing its last-activity timestamp if already running) —
  // this is the one place that guarantees indexing/watching happens
  // for every active student without having to call it separately
  // at each of the ~15 route handlers that call getSessionKey.
  ensureWatching(sessionKey);

  return sessionKey;
}

module.exports = { sanitizeKeyPart, getSessionKey };
