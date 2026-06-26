// Handles login, registration, and JWT token generation
const jwt = require("jsonwebtoken");

function login(req, res) {
  if (!req.body || !req.body.email || !req.body.password) {
    return res.status(400).json({ message: "All fields are required" });
  }
  
  const { email, password } = req.body;
  
  // verify credentials, generate token
}

module.exports = { login };