const secret = process.env.JWT_SECRET;

if (!secret || secret.length < 32) {
  throw new Error(
    "JWT_SECRET is missing or too short. Set it in backend/.env to a random value of at least 32 characters (generate one with: openssl rand -hex 32)."
  );
}

module.exports = secret;
