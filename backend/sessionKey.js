const { sanitizeKeyPart } = require("./sanitize");
const { ensureWatching } = require("./fileIndexer");

function getSessionKey(req) {
  const studentId = sanitizeKeyPart(req.userId);
  const projectName = sanitizeKeyPart(req.body && req.body.projectName);
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
