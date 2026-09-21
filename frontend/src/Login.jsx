import { useState, useEffect, useRef } from "react";
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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" style={{ width: 17, height: 17 }}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.6 6.1 29.6 4 24 4c-7.4 0-13.8 4.1-17.1 10.1z" />
      <path fill="#4CAF50" d="M24 45c5.5 0 10.4-1.9 14.1-5.1l-6.5-5.5c-2 1.5-4.6 2.5-7.6 2.5-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.9 40.8 16.4 45 24 45z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.5 5.5C41.2 36 45 30.6 45 24c0-1.4-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Login({ onLogin }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  const isLogin = mode === "login";
  const googleButtonRef = useRef(null);

  const switchMode = (next) => {
    setMode(next);
    setError("");
    setInfo("");
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      const response = await fetch("http://localhost:5000/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }
      setInfo("If that email has an account, a reset link is on its way.");
    } catch (err) {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendCode = async () => {
    setError("");
    setInfo("");
    if (!email) {
      setError("Enter your email first.");
      return;
    }
    try {
      const response = await fetch("http://localhost:5000/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Could not send verification code");
        return;
      }
      setCodeSent(true);
      setInfo("Verification code sent — check your email.");
    } catch (err) {
      setError("Could not reach the server.");
    }
  };

  // Google Identity Services requires a real click on its own rendered
  // button element to trigger the account picker -- a programmatic
  // popup triggered from arbitrary JS is blocked by browsers as a
  // security measure. Rendered into a visually hidden (but still
  // clickable) container so the app's own styled button can trigger
  // it by proxy, keeping the existing design instead of Google's
  // default button styling.
  useEffect(() => {
    let cancelled = false;

    async function initGoogle() {
      try {
        const response = await fetch("http://localhost:5000/api/auth/google-client-id");
        const data = await response.json();
        if (cancelled || !data.clientId || !window.google || !googleButtonRef.current) return;

        window.google.accounts.id.initialize({
          client_id: data.clientId,
          callback: handleGoogleCredentialResponse
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large"
        });
      } catch (err) {
        // Google sign-in simply won't be available if this fails
        // (e.g. offline, or the script hasn't loaded yet) -- not
        // fatal to the rest of the login page.
      }
    }

    initGoogle();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleCredentialResponse = async (response) => {
    setError("");
    setInfo("");
    try {
      const res = await fetch("http://localhost:5000/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Google sign-in failed");
        return;
      }
      setToken(data.token);
      onLogin();
    } catch (err) {
      setError("Could not reach the server.");
    }
  };

  const handleGoogle = () => {
    const realButton = googleButtonRef.current && googleButtonRef.current.querySelector("div[role=\"button\"]");
    if (realButton) {
      realButton.click();
    } else {
      setError("Google sign-in isn't ready yet — try again in a moment.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (mode === "register" && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    const endpoint = isLogin ? "login" : "register";

    try {
      // The backend currently authenticates by `username`; we pass the
      // email straight through as that value. Registration additionally
      // requires the emailed verification code.
      const response = await fetch(`http://localhost:5000/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "register" ? { username: email, password, code } : { username: email, password }
        )
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Something went wrong");
        setLoading(false);
        return;
      }

      if (isLogin) {
        setToken(data.token);
        onLogin();
      } else {
        setMode("login");
        setInfo("Account created. Log in below.");
        setPassword("");
        setConfirmPassword("");
        setCode("");
        setCodeSent(false);
      }
    } catch (err) {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  if (showForgot) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <div style={styles.mark}>
            <span style={styles.dot} />
            taifa ai
          </div>
          <h2 style={styles.heading}>Reset your password</h2>
          <p style={styles.sub}>Enter your email and we&rsquo;ll send you a reset link.</p>

          {error && <div style={{ ...styles.msg, ...styles.msgErr }}>{error}</div>}
          {info && <div style={{ ...styles.msg, ...styles.msgOk }}>{info}</div>}

          <form onSubmit={handleForgotSubmit}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="forgotEmail">Email address</label>
              <input
                id="forgotEmail"
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                required
              />
            </div>
            <button type="submit" disabled={loading} style={styles.submit}>
              {loading ? "..." : "Send reset link"}
            </button>
          </form>

          <div style={styles.switchLine}>
            <button
              onClick={() => { setShowForgot(false); setError(""); setInfo(""); }}
              style={styles.switchBtn}
            >
              Back to log in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.mark}>
          <span style={styles.dot} />
          taifa ai
        </div>
        <p style={styles.tagline}>Offline-first coding agent · runs on-device, no cloud</p>

        <h2 style={styles.heading}>{isLogin ? "Welcome back" : "Create your account"}</h2>
        <p style={styles.sub}>
          {isLogin ? "Sign in with the email on your account." : "Verify your email to get started."}
        </p>

        {error && <div style={{ ...styles.msg, ...styles.msgErr }}>{error}</div>}
        {info && <div style={{ ...styles.msg, ...styles.msgOk }}>{info}</div>}

        <form onSubmit={handleSubmit}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ ...styles.input, ...styles.inputWithToggle }}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                style={styles.eyeBtn}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
          </div>

          {!isLogin && (
            <div style={styles.field}>
              <label style={styles.label} htmlFor="confirmPassword">Confirm password</label>
              <div style={styles.inputBox}>
                <input
                  id="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  placeholder="••••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ ...styles.input, ...styles.inputWithToggle }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  style={styles.eyeBtn}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            </div>
          )}

          {!isLogin && (
            <div style={styles.field}>
              <label style={styles.label} htmlFor="code">Verification code</label>
              <div style={styles.codeRow}>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  style={styles.input}
                />
                <button type="button" onClick={handleSendCode} style={styles.sendCodeBtn}>
                  {codeSent ? "Resend" : "Send code"}
                </button>
              </div>
            </div>
          )}

          {isLogin && (
            <div style={styles.rowBetween}>
              <button type="button" onClick={() => switchMode("register")} style={styles.hintLink}>
                Need an account? Sign up
              </button>
              <button type="button" onClick={() => { setShowForgot(true); setError(""); setInfo(""); }} style={styles.hintLink}>Forgot password?</button>
            </div>
          )}

          {!isLogin && (
            <p style={styles.consent}>
              By signing up, you consent to Taifa AI&rsquo;s Terms of Use and Privacy Policy.
            </p>
          )}

          <button type="submit" disabled={loading} style={styles.submit}>
            {loading ? "..." : isLogin ? "Log in" : "Sign up"}
          </button>
        </form>

        {isLogin && (
          <>
            <div style={styles.divider}>or</div>
            <button type="button" onClick={handleGoogle} style={styles.googleBtn}>
              <GoogleIcon />
              Continue with Google
            </button>
            <div ref={googleButtonRef} style={styles.hiddenGoogleButton} />
          </>
        )}

        {!isLogin && (
          <div style={styles.switchLine}>
            Already have an account?{" "}
            <button onClick={() => switchMode("login")} style={styles.switchBtn}>Log in</button>
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
  // Tap target spans the input's full height on its right edge, not
  // just the icon itself -- a small fixed 17x17 hitbox was well under
  // the ~44px minimum recommended for mobile touch targets, making it
  // genuinely hard to tap reliably.
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
  codeRow: { display: "flex", gap: 8 },
  sendCodeBtn: {
    flexShrink: 0,
    background: "var(--surface-raised)",
    border: "1px solid var(--border)",
    color: "var(--accent)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.76rem",
    padding: "0 14px",
    borderRadius: 5,
    cursor: "pointer",
    whiteSpace: "nowrap"
  },
  rowBetween: {
    display: "flex",
    justifyContent: "space-between",
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
  divider: {
    margin: "22px 0",
    textAlign: "center",
    fontFamily: "var(--font-mono)",
    fontSize: "0.72rem",
    color: "var(--text-muted)"
  },
  googleBtn: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    background: "var(--surface-raised)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.85rem",
    padding: "11px 14px",
    borderRadius: 5,
    cursor: "pointer"
  },
  // Google's real button renders here, off-screen -- the app's own
  // styled googleBtn triggers a click on this one by proxy, since a
  // programmatic sign-in popup with no real button click is blocked
  // by browsers as a security measure.
  hiddenGoogleButton: {
    position: "absolute",
    top: -9999,
    left: -9999,
    width: 240,
    height: 44
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
