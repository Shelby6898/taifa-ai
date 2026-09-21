import { useState } from "react";

function ResetPassword({ token }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }

      setDone(true);
    } catch (err) {
      setError("Could not reach the server.");
      setLoading(false);
    }
  };

  const goToLogin = () => {
    window.location.href = "/";
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.mark}>
          <span style={styles.dot} />
          taifa ai
        </div>

        {done ? (
          <>
            <h2 style={styles.heading}>Password reset</h2>
            <p style={styles.sub}>Your password has been updated. You can log in with it now.</p>
            <button type="button" onClick={goToLogin} style={styles.submit}>
              Back to log in
            </button>
          </>
        ) : (
          <>
            <h2 style={styles.heading}>Choose a new password</h2>
            <p style={styles.sub}>Enter a new password for your account.</p>

            {error && <div style={{ ...styles.msg, ...styles.msgErr }}>{error}</div>}

            <form onSubmit={handleSubmit}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="newPassword">New password</label>
                <input
                  id="newPassword"
                  type="password"
                  placeholder="••••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={styles.input}
                  required
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label} htmlFor="confirmPassword">Confirm new password</label>
                <input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={styles.input}
                  required
                />
              </div>

              <button type="submit" disabled={loading} style={styles.submit}>
                {loading ? "..." : "Reset password"}
              </button>
            </form>
          </>
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
    marginBottom: 24
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 2,
    background: "var(--accent)",
    transform: "rotate(45deg)",
    display: "inline-block"
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
  submit: {
    width: "100%",
    background: "var(--accent-dim)",
    borderColor: "var(--accent)",
    color: "var(--accent)",
    fontWeight: 600
  }
};

export default ResetPassword;
