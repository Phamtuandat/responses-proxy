/**
 * Login Screen — Simple password auth with optional Telegram 2FA.
 *
 * Flow:
 * 1. User enters admin password → POST /api/dashboard-auth/login
 * 2. If password auth is not configured, falls back to Telegram approval
 * 3. On success, sets session cookie and navigates to dashboard
 */

import { useEffect, useState } from "react";
import { getDashboardApprovalStatus, requestDashboardApproval } from "../api/client";
import { apiSend } from "../api/client";
import type { DashboardAuthSession } from "../api/types";
import { InlineAlert } from "../components/InlineAlert";
import { SurfaceCard } from "../components/SurfaceCard";

type LoginScreenProps = {
  onAuthenticated: (session: DashboardAuthSession) => void;
};

type ApprovalState = {
  challengeId: string;
  pollToken: string;
  displayCode: string;
  expiresAt: string;
};

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [mode, setMode] = useState<"password" | "telegram">("password");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState("");

  // Telegram approval state
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: "success" | "error"; message: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "approved" | "rejected" | "expired">("idle");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [windowSeconds, setWindowSeconds] = useState(0);

  // Password login
  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) { setError("Password is required"); return; }
    setLoggingIn(true);
    setError("");
    try {
      const result = await apiSend<{ ok: boolean; session: DashboardAuthSession }>("/api/dashboard-auth/login", "POST", { password });
      if (result.session) {
        onAuthenticated(result.session);
      }
    } catch (err: any) {
      const msg = err.message || "Login failed";
      if (msg.includes("not configured")) {
        // Password not configured — switch to Telegram mode
        setMode("telegram");
      } else {
        setError(msg);
      }
    } finally {
      setLoggingIn(false);
    }
  }

  // Telegram polling
  useEffect(() => {
    if (!approval || status !== "pending") return;
    const interval = window.setInterval(() => void pollApprovalStatus(), 1500);
    return () => window.clearInterval(interval);
  }, [approval, status]);

  useEffect(() => {
    if (!approval) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [approval]);

  async function pollApprovalStatus() {
    if (!approval) return;
    try {
      const result = await getDashboardApprovalStatus(approval.challengeId, approval.pollToken);
      if (result.status === "approved" && result.session) {
        setStatus("approved");
        onAuthenticated(result.session);
        return;
      }
      if (result.status === "rejected" || result.status === "expired") {
        setStatus(result.status);
        setFeedback({ variant: "error", message: result.status === "rejected" ? "Admin rejected. Try again." : "Expired. Request again." });
        return;
      }
      setStatus("pending");
    } catch {
      setStatus("idle");
      setApproval(null);
    }
  }

  async function handleRequestApproval() {
    setPending(true);
    setFeedback(null);
    try {
      const result = await requestDashboardApproval();
      setApproval({ challengeId: result.challengeId, pollToken: result.pollToken, displayCode: result.displayCode, expiresAt: result.expiresAt });
      setStatus("pending");
      setNowMs(Date.now());
      setWindowSeconds(Math.max(1, Math.ceil((new Date(result.expiresAt).getTime() - Date.now()) / 1000)));
      setFeedback({ variant: "success", message: "Approval sent to Telegram admin." });
    } catch (err: any) {
      setFeedback({ variant: "error", message: err.message || "Failed to request approval." });
    } finally {
      setPending(false);
    }
  }

  const expiresInSeconds = approval ? Math.max(0, Math.ceil((new Date(approval.expiresAt).getTime() - nowMs) / 1000)) : 0;
  const countdownPercent = windowSeconds > 0 ? Math.min(100, (expiresInSeconds / windowSeconds) * 100) : 0;

  return (
    <div className="login-page">
      <SurfaceCard className="login-card">
        <span className="login-mark" aria-hidden="true">RP</span>
        <p className="eyebrow">Admin dashboard</p>
        <h1>Sign in</h1>

        {mode === "password" ? (
          <>
            <p className="muted-copy">Enter your admin password to access the dashboard.</p>
            {error && <InlineAlert variant="error" message={error} />}
            <form className="login-form" onSubmit={handlePasswordLogin} style={{ display: "grid", gap: "var(--space-3)" }}>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Admin password"
                autoFocus
                autoComplete="current-password"
                style={{ minHeight: 46 }}
              />
              <button className="button-primary" type="submit" disabled={loggingIn}>
                {loggingIn ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setMode("telegram")}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-xs)", marginTop: "var(--space-3)", padding: 0 }}
            >
              Use Telegram approval instead →
            </button>
          </>
        ) : (
          <>
            <p className="muted-copy">Request approval from your Telegram admin.</p>
            {feedback && <InlineAlert variant={feedback.variant} message={feedback.message} />}
            <div className="login-form">
              <button className="button-primary" type="button" disabled={pending} onClick={handleRequestApproval}>
                {pending ? "Sending…" : approval ? "Request again" : "Request Telegram approval"}
              </button>
            </div>
            {approval && (
              <div className="login-form" style={{ marginTop: "var(--space-3)" }}>
                <div className="login-code-display" aria-label="Approval code">{approval.displayCode}</div>
                <div className="login-countdown">
                  <div className="login-countdown-track" role="progressbar" aria-valuemin={0} aria-valuemax={windowSeconds} aria-valuenow={expiresInSeconds}>
                    <div className="login-countdown-fill" style={{ width: `${countdownPercent}%` }} />
                  </div>
                  <div className="login-status-row">
                    {status === "pending" && <span className="login-spinner" aria-hidden="true" />}
                    <span>{status === "pending" ? "Waiting for admin" : `Status: ${status}`} · {expiresInSeconds}s</span>
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setMode("password")}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-xs)", marginTop: "var(--space-3)", padding: 0 }}
            >
              ← Use password instead
            </button>
          </>
        )}
      </SurfaceCard>
    </div>
  );
}
