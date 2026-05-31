import { useEffect, useState } from "react";
import { getDashboardApprovalStatus, requestDashboardApproval } from "../api/client";
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
  const [approval, setApproval] = useState<ApprovalState | null>(null);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: "success" | "error"; message: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "approved" | "rejected" | "expired">("idle");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [windowSeconds, setWindowSeconds] = useState(0);

  useEffect(() => {
    if (!approval || status !== "pending") {
      return;
    }

    const interval = window.setInterval(() => {
      void pollApprovalStatus();
    }, 1500);
    return () => window.clearInterval(interval);
  }, [approval, status]);

  useEffect(() => {
    if (!approval) {
      return;
    }
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [approval]);

  async function pollApprovalStatus() {
    if (!approval) {
      return;
    }
    try {
      const result = await getDashboardApprovalStatus(approval.challengeId, approval.pollToken);
      if (result.status === "approved" && result.session) {
        setStatus("approved");
        onAuthenticated(result.session);
        return;
      }
      if (result.status === "rejected" || result.status === "expired") {
        setStatus(result.status);
        setFeedback({
          variant: "error",
          message: result.status === "rejected" ? "Telegram admin chose the wrong code. Request a new login." : "Approval request expired. Request a new login.",
        });
        return;
      }
      setStatus(result.status === "consumed" ? "approved" : "pending");
    } catch (error) {
      setStatus("idle");
      setApproval(null);
      setFeedback({
        variant: "error",
        message: error instanceof Error ? error.message : "Could not check approval status.",
      });
    }
  }

  async function handleRequestApproval() {
    setPending(true);
    setFeedback(null);
    try {
      const result = await requestDashboardApproval();
      setApproval({
        challengeId: result.challengeId,
        pollToken: result.pollToken,
        displayCode: result.displayCode,
        expiresAt: result.expiresAt,
      });
      setStatus("pending");
      setNowMs(Date.now());
      setWindowSeconds(
        Math.max(1, Math.ceil((new Date(result.expiresAt).getTime() - Date.now()) / 1000)),
      );
      setFeedback({
        variant: "success",
        message: `Approval request sent to Telegram admin${result.sentCount && result.sentCount > 1 ? "s" : ""}.`,
      });
    } catch (error) {
      setFeedback({ variant: "error", message: error instanceof Error ? error.message : "Could not request Telegram approval." });
    } finally {
      setPending(false);
    }
  }

  const expiresInSeconds = approval ? Math.max(0, Math.ceil((new Date(approval.expiresAt).getTime() - nowMs) / 1000)) : 0;
  const countdownPercent = windowSeconds > 0 ? Math.min(100, Math.max(0, (expiresInSeconds / windowSeconds) * 100)) : 0;
  const isWaiting = status === "pending";

  return (
    <div className="login-page">
      <SurfaceCard className="login-card">
        <span className="login-mark" aria-hidden="true">RP</span>
        <p className="eyebrow">Admin dashboard</p>
        <h1>Approve login in Telegram</h1>
        <p className="muted-copy">
          Request approval, then choose the matching number in your Telegram admin chat.
        </p>
        {feedback ? <InlineAlert variant={feedback.variant} message={feedback.message} /> : null}
        <div className="login-form">
          <button className="button-primary" type="button" disabled={pending} onClick={handleRequestApproval}>
            {pending ? "Sending…" : approval ? "Request new approval" : "Request Telegram approval"}
          </button>
        </div>
        {approval ? (
          <div className="login-form">
            <div className="login-code-display" aria-label="Approval code">
              {approval.displayCode}
            </div>
            <div className="login-countdown">
              <div className="login-countdown-track" role="progressbar" aria-valuemin={0} aria-valuemax={windowSeconds} aria-valuenow={expiresInSeconds}>
                <div className="login-countdown-fill" style={{ width: `${countdownPercent}%` }} />
              </div>
              <div className="login-status-row">
                {isWaiting ? <span className="login-spinner" aria-hidden="true" /> : null}
                <span>
                  {isWaiting ? "Waiting for Telegram admin" : `Status: ${status}`} · expires in {expiresInSeconds}s
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </SurfaceCard>
    </div>
  );
}
