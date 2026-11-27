import { useEffect, useState } from "react";
import { authFetch } from "./authFetch";

const API = "http://localhost:5000/api/auth";

function AccountSettings({ onClose }) {
  const [username, setUsername] = useState("");
  const [usernamePassword, setUsernamePassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;

    authFetch(`${API}/me`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load account.");
        if (active) {
          setUsername(data.user.username);
          setNewUsername(data.user.username);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const changeUsername = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,23}$/.test(newUsername)) {
      setError("Username must be 3–24 characters and use letters, numbers, underscores or hyphens.");
      return;
    }

    setSaving(true);
    try {
      const response = await authFetch(`${API}/change-username`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: usernamePassword,
          newUsername
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update username.");

      setUsername(data.username);
      setNewUsername(data.username);
      setUsernamePassword("");
      setSuccess(data.message || "Username updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      const response = await authFetch(`${API}/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordCurrent,
          newPassword
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update password.");

      setPasswordCurrent("");
      setNewPassword("");
      setSuccess(data.message || "Password updated.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle = {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 12px",
    marginTop: 7,
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--surface)",
    color: "var(--text)",
    fontSize: 13
  };

  const labelStyle = {
    display: "block",
    marginTop: 13,
    color: "var(--text-muted)",
    fontSize: 12
  };

  const buttonStyle = {
    marginTop: 16,
    padding: "10px 15px",
    border: "none",
    borderRadius: 7,
    background: "var(--accent)",
    color: "#111",
    fontWeight: 700,
    cursor: saving ? "wait" : "pointer",
    opacity: saving ? 0.65 : 1
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(0,0,0,.68)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        overflowY: "auto"
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-settings-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 23,
          border: "1px solid var(--border)",
          borderRadius: 12,
          background: "var(--panel)",
          color: "var(--text)",
          boxShadow: "0 20px 60px rgba(0,0,0,.35)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "var(--accent)", fontSize: 10, letterSpacing: 1.5 }}>
              ACCOUNT SECURITY
            </div>
            <h2 id="account-settings-title" style={{ margin: "6px 0 0", fontSize: 20 }}>
              Manage account
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close account settings">
            ✕
          </button>
        </div>

        {loading ? (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading account…</p>
        ) : (
          <>
            <div style={{ marginTop: 18, padding: 12, borderRadius: 8, background: "var(--surface)" }}>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>CURRENT USERNAME</div>
              <strong style={{ display: "block", marginTop: 5, fontSize: 14 }}>{username}</strong>
            </div>

            {error && (
              <p role="alert" style={{ color: "#e58c8c", fontSize: 12 }}>{error}</p>
            )}
            {success && (
              <p role="status" style={{ color: "#69c99a", fontSize: 12 }}>{success}</p>
            )}

            <form onSubmit={changeUsername}>
              <h3 style={{ margin: "22px 0 4px", fontSize: 14 }}>Change username</h3>
              <label style={labelStyle}>
                New username
                <input
                  style={fieldStyle}
                  value={newUsername}
                  onChange={(event) => setNewUsername(event.target.value)}
                  autoComplete="username"
                  maxLength={24}
                  required
                />
              </label>
              <label style={labelStyle}>
                Current password
                <input
                  style={fieldStyle}
                  type="password"
                  value={usernamePassword}
                  onChange={(event) => setUsernamePassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <button style={buttonStyle} type="submit" disabled={saving}>
                {saving ? "Saving…" : "Update username"}
              </button>
            </form>

            <div style={{ borderTop: "1px solid var(--border)", margin: "22px 0" }} />

            <form onSubmit={changePassword}>
              <h3 style={{ margin: "0 0 4px", fontSize: 14 }}>Change password</h3>
              <label style={labelStyle}>
                Current password
                <input
                  style={fieldStyle}
                  type="password"
                  value={passwordCurrent}
                  onChange={(event) => setPasswordCurrent(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label style={labelStyle}>
                New password
                <input
                  style={fieldStyle}
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <button style={buttonStyle} type="submit" disabled={saving}>
                {saving ? "Saving…" : "Update password"}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

export default AccountSettings;
