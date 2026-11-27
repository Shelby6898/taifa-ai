const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const User = require("./authStore");
const { requireAuth } = require("./authMiddleware");
const JWT_SECRET = require("./jwtSecret");

function generateToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: "12h" });
}

function validUsername(username) {
  return typeof username === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,23}$/.test(username.trim());
}

function validPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please try again later." }
});

const accountChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many account changes. Please try again later." }
});

router.post("/register", registerLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (!validUsername(username)) {
    return res.status(400).json({
      error: "Username must be 3–24 characters: letters, numbers, underscores or hyphens."
    });
  }

  if (!validPassword(password)) {
    return res.status(400).json({
      error: "Password must be at least 8 characters."
    });
  }

  try {
    const user = await User.create({ username, password });
    return res.status(201).json({
      message: "Account created successfully. Log in below.",
      user
    });
  } catch (error) {
    return res.status(400).json({
      error: error.message || "Failed to create account."
    });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== "string" || !username.trim() ||
      typeof password !== "string" || !password) {
    return res.status(400).json({
      error: "Username and password are required."
    });
  }

  try {
    const user = await User.findOne({ username });
    if (!user || !user.password) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const matches = await bcrypt.compare(password, user.password);
    if (!matches) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    return res.json({
      message: "Login successful",
      token: generateToken(user._id),
      username: user.username
    });
  } catch (error) {
    console.error("Local login failed:", error.message);
    return res.status(500).json({ error: "Failed to log in." });
  }
});

router.get("/me", requireAuth, (req, res) => {
  try {
    const user = User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "Account not found." });

    return res.json({
      user: {
        id: user._id,
        username: user.username
      }
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to load account." });
  }
});

router.post("/change-username", requireAuth, accountChangeLimiter, async (req, res) => {
  const { currentPassword, newUsername } = req.body || {};

  if (!validUsername(newUsername)) {
    return res.status(400).json({
      error: "New username must be 3–24 characters: letters, numbers, underscores or hyphens."
    });
  }

  if (typeof currentPassword !== "string" || !currentPassword) {
    return res.status(400).json({ error: "Current password is required." });
  }

  try {
    const user = await User.changeUsername(
      req.userId,
      currentPassword,
      newUsername
    );
    return res.json({
      message: "Username updated successfully.",
      username: user.username
    });
  } catch (error) {
    const status = error.message === "Account not found" ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
});

router.post("/change-password", requireAuth, accountChangeLimiter, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (typeof currentPassword !== "string" || !currentPassword) {
    return res.status(400).json({ error: "Current password is required." });
  }

  if (!validPassword(newPassword)) {
    return res.status(400).json({
      error: "New password must be at least 8 characters."
    });
  }

  try {
    await User.changePassword(req.userId, currentPassword, newPassword);
    return res.json({ message: "Password updated successfully." });
  } catch (error) {
    const status = error.message === "Account not found" ? 404 : 400;
    return res.status(status).json({ error: error.message });
  }
});

module.exports = router;
