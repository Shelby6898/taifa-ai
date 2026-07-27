function sanitizeKeyPart(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

module.exports = { sanitizeKeyPart };
