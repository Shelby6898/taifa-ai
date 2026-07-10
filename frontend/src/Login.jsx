import { useState } from "react";
import { setToken } from "./authFetch";

function Login({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);

    const endpoint = mode === "login" ? "login" : "register";

    try {
      const response = await fetch(`http://localhost:5000/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }

      if (mode === "login") {
        setToken(data.token);
        onLogin();
      } else {
        setMode("login");
        setInfo("Account created. Log in below.");
        setPassword("");
      }
    } catch (err) {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.prompt}>
          <span style={styles.promptUser}>taifa</span>
          <span style={styles.promptSep}>@</span>
          <span style={styles.promptHost}>ai</span>
          <span className="cursor-blink" style={{ height: "1em" }} />
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>username</label>
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={styles.input}
          />

          <label style={styles.label}>password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />

          {error && <div style={styles.error}>error: {error}</div>}
          {info && <div style={styles.info}>{info}</div>}

          <button type="submit" disabled={loading} style={styles.submit}>
            {loading ? "running..." : mode === "login" ? "run login" : "run register"}
          </button>
        </form>

        <button
          onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setInfo(""); }}
          style={styles.switchMode}
        >
          {mode === "login" ? "→ no account? register" : "→ have an account? login"}
        </button>
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
    maxWidth: 360,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 28
  },
  prompt: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.95rem",
    color: "var(--text-muted)",
    marginBottom: 24,
    display: "flex",
    alignItems: "center"
  },
  promptUser: { color: "var(--accent)" },
  promptHost: { color: "var(--text)" },
  promptSep: { color: "var(--text-muted)", margin: "0 1px" },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 6
  },
  label: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.72rem",
    color: "var(--text-muted)",
    marginTop: 10,
    textTransform: "lowercase",
    letterSpacing: "0.02em"
  },
  input: {
    marginBottom: 2
  },
  error: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.8rem",
    color: "var(--danger)",
    marginTop: 12
  },
  info: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.8rem",
    color: "var(--success)",
    marginTop: 12
  },
  submit: {
    marginTop: 18,
    background: "var(--accent-dim)",
    borderColor: "var(--accent)",
    color: "var(--accent)",
    fontWeight: 600
  },
  switchMode: {
    marginTop: 16,
    background: "none",
    border: "none",
    color: "var(--text-muted)",
    fontSize: "0.78rem",
    padding: 0,
    textDecoration: "none"
  }
};

export default Login;
