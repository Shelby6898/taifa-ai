const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const { Resend } = require("resend");
const { OAuth2Client } = require("google-auth-library");
const User = require("./authStore");
const { generateCode, verifyCode } = require("./verificationCodes");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const resend = new Resend(process.env.RESEND_API_KEY);
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function generateToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: "12h" });
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

const sendCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification code requests. Please try again later." }
});

router.post("/send-code", sendCodeLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const code = generateCode(email);

  try {
    await resend.emails.send({
      from: "Taifa AI <onboarding@resend.dev>",
      to: email,
      subject: "Your Taifa AI verification code",
      text: `Your verification code is ${code}. It expires in 10 minutes.`
    });
    res.json({ message: "Verification code sent" });
  } catch (error) {
    console.error("Failed to send verification email:", error.message);
    res.status(500).json({ error: "Failed to send verification email" });
  }
});

router.post("/register", registerLimiter, async (req, res) => {
  const { username, password, code } = req.body;
  if (!username || !password || !code) {
    return res.status(400).json({ error: "Username, password, and verification code are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const codeResult = verifyCode(username, code);
  if (!codeResult.valid) {
    return res.status(400).json({ error: codeResult.reason });
  }

  try {
    const user = await User.create({ username, password });
    res.status(201).json({ message: "Registered successfully", user });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to register user" });
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) return res.status(401).json({ error: "Invalid credentials" });

    res.json({ message: "Login successful", token: generateToken(user._id), username: user.username });
  } catch (error) {
    res.status(500).json({ error: "Failed to login user" });
  }
});

// Frontend sends the ID token it gets back from Google Identity
// Services after the user picks an account -- this route is the only
// place that ever trusts it, by verifying the signature and audience
// against our own registered client ID before extracting anything
// from its payload.
router.post("/google", loginLimiter, async (req, res) => {
  const { credential } = req.body;
  if (!credential) {
    return res.status(400).json({ error: "Google credential is required" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();

    const user = await User.linkOrCreateGoogleUser({ googleId: payload.sub, email: payload.email });
    res.json({ message: "Login successful", token: generateToken(user._id), username: user.username });
  } catch (error) {
    console.error("Google sign-in failed:", error.message);
    res.status(401).json({ error: "Google sign-in failed" });
  }
});

// The client ID itself isn't a secret (it's meant to be public -- it's
// sent to Google directly from the browser), but keeping it in one
// place server-side avoids needing a separate frontend build-time env
// var that has to be kept in sync with this one.
router.get("/google-client-id", (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
});

module.exports = router;
