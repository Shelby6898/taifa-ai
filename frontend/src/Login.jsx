import { useState } from "react";
import { setToken } from "./authFetch";

function EyeIcon({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18, display: "block" }}>
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18, display: "block" }}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A11.6 11.6 0 0 1 12 5c7 0 11 7 11 7a17.9 17.9 0 0 1-3.3 4.3M6.5 6.6C3.4 8.6 1 12 1 12s4 7 11 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const isLogin = mode === "login";

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setInfo("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    const cleanUsername = username.trim();

    if (!cleanUsername) {
      setError("Enter your username.");
      return;
    }

    if (!isLogin && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,23}$/.test(cleanUsername)) {
      setError("Username must be 3–24 characters using letters, numbers, underscores or hyphens.");
      return;
    }

    if (!isLogin && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const endpoint = isLogin ? "login" : "register";
      const response = await fetch(`http://localhost:5000/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: cleanUsername,
          password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      if (isLogin) {
        setToken(data.token);
        onLogin();
      } else {
        setMode("login");
        setPassword("");
        setConfirmPassword("");
        setInfo("Account created successfully. Log in below.");
      }
    } catch {
      setError("Could not reach the local Taifa AI server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.mark}>
          <span style={styles.dot} />
          taifa ai
        </div>

        <p style={styles.tagline}>
          Offline-first coding agent · runs on-device, no cloud
        </p>

        <h2 style={styles.heading}>
          {isLogin ? "Welcome back" : "Create your account"}
        </h2>

        <p style={styles.sub}>
          {isLogin
            ? "Sign in with your local username and password."
            : "Create a local account on this device."}
        </p>

        {error && <div style={{ ...styles.msg, ...styles.msgErr }}>{error}</div>}
        {info && <div style={{ ...styles.msg, ...styles.msgOk }}>{info}</div>}

        <form onSubmit={handleSubmit}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              maxLength={24}
              placeholder="your_username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={styles.input}
              required
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label} htmlFor="password">Password</label>
            <div style={styles.inputBox}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isLogin ? "current-password" : "new-password"}
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...styles.input, ...styles.inputWithToggle }}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                style={styles.eyeBtn}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>

          {!isLogin && (
            <div style={styles.field}>
              <label style={styles.label} htmlFor="confirmPassword">
                Confirm password
              </label>
              <div style={styles.inputBox}>
                <input
                  id="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ ...styles.input, ...styles.inputWithToggle }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(v => !v)}
                  style={styles.eyeBtn}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            </div>
          )}

          {isLogin && (
            <div style={styles.rowBetween}>
              <button
                type="button"
                onClick={() => switchMode("register")}
                style={styles.hintLink}
              >
                Need an account? Sign up
              </button>
            </div>
          )}

          {!isLogin && (
            <p style={styles.consent}>
              Your account is stored locally on this device. No email or
              external identity provider is required.
            </p>
          )}

          <button type="submit" disabled={loading} style={styles.submit}>
            {loading ? "..." : isLogin ? "Log in" : "Create account"}
          </button>
        </form>

        {!isLogin && (
          <div style={styles.switchLine}>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("login")}
              style={styles.switchBtn}
            >
              Log in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24
  },
  card: {
    width: "100%",
    maxWidth: 400,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 28
  },
  mark: {
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
    fontSize: "1.05rem",
    color: "var(--text)",
    display: "flex",
    alignItems: "center",
    gap: 9,
    marginBottom: 10
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 2,
    background: "var(--accent)",
    transform: "rotate(45deg)",
    display: "inline-block"
  },
  tagline: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.74rem",
    color: "var(--text-muted)",
    margin: "0 0 24px"
  },
  heading: {
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
    fontSize: "1.3rem",
    margin: "0 0 6px"
  },
  sub: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.83rem",
    color: "var(--text-muted)",
    margin: "0 0 22px",
    lineHeight: 1.5
  },
  field: { marginBottom: 16 },
  label: {
    display: "block",
    fontFamily: "var(--font-mono)",
    fontSize: "0.72rem",
    color: "var(--text-muted)",
    marginBottom: 7
  },
  input: {
    width: "100%",
    fontFamily: "var(--font-mono)"
  },
  inputBox: { position: "relative", display: "flex", alignItems: "center" },
  inputWithToggle: { paddingRight: 46 },
  eyeBtn: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: 44,
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    color: "var(--text)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 0
  },
  rowBetween: {
    display: "flex",
    justifyContent: "flex-start",
    alignItems: "center",
    margin: "2px 0 20px",
    fontSize: "0.76rem"
  },
  hintLink: {
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.76rem",
    cursor: "pointer",
    padding: 0
  },
  consent: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.74rem",
    lineHeight: 1.6,
    color: "var(--text-muted)",
    margin: "4px 0 20px"
  },
  msg: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.8rem",
    padding: "10px 12px",
    borderRadius: 5,
    marginBottom: 18,
    lineHeight: 1.5
  },
  msgErr: {
    background: "rgba(221,107,92,0.1)",
    border: "1px solid rgba(221,107,92,0.3)",
    color: "var(--danger)"
  },
  msgOk: {
    background: "rgba(87,183,136,0.1)",
    border: "1px solid rgba(87,183,136,0.3)",
    color: "var(--success)"
  },
  submit: {
    width: "100%",
    background: "var(--accent-dim)",
    borderColor: "var(--accent)",
    color: "var(--accent)",
    fontWeight: 600
  },
  switchLine: {
    marginTop: 24,
    textAlign: "center",
    fontFamily: "var(--font-mono)",
    fontSize: "0.82rem",
    color: "var(--text-muted)"
  },
  switchBtn: {
    background: "none",
    border: "none",
    color: "var(--accent)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.82rem",
    cursor: "pointer",
    padding: 0
  }
};

export default Login;
