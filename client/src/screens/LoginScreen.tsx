import { FormEvent, useState } from "react";
import { requestDashboardOtp, verifyDashboardOtp } from "../api/client";
import type { DashboardAuthSession } from "../api/types";
import { InlineAlert } from "../components/InlineAlert";
import { SurfaceCard } from "../components/SurfaceCard";

type LoginScreenProps = {
  onAuthenticated: (session: DashboardAuthSession) => void;
};

type LoginStep = "request" | "verify";

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [telegramUserId, setTelegramUserId] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<LoginStep>("request");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  async function handleRequestOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback(null);
    try {
      const result = await requestDashboardOtp(telegramUserId.trim());
      setStep("verify");
      setFeedback({
        variant: "success",
        message: `OTP sent via Telegram. Expires at ${result.expiresAt}.`,
      });
    } catch (error) {
      setFeedback({ variant: "error", message: error instanceof Error ? error.message : "Could not send OTP." });
    } finally {
      setPending(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback(null);
    try {
      const result = await verifyDashboardOtp(telegramUserId.trim(), otp.trim());
      onAuthenticated(result.session);
    } catch (error) {
      setFeedback({ variant: "error", message: error instanceof Error ? error.message : "Could not verify OTP." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <SurfaceCard className="login-card">
        <p className="eyebrow">Admin dashboard</p>
        <h1>Login with Telegram OTP</h1>
        <p className="muted-copy">
          Enter your admin Telegram user id. The bot will send a 6-digit OTP to your Telegram account.
        </p>
        {feedback ? <InlineAlert variant={feedback.variant} message={feedback.message} /> : null}
        <form className="login-form" onSubmit={step === "request" ? handleRequestOtp : handleVerifyOtp}>
          <label>
            Telegram user id
            <input
              value={telegramUserId}
              onChange={(event) => setTelegramUserId(event.target.value)}
              placeholder="1283361952"
              inputMode="numeric"
              autoComplete="username"
              disabled={pending || step === "verify"}
            />
          </label>
          {step === "verify" ? (
            <label>
              OTP
              <input
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="123456"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                disabled={pending}
              />
            </label>
          ) : null}
          <button className="button-primary" type="submit" disabled={pending}>
            {pending ? "Working…" : step === "request" ? "Send OTP" : "Verify OTP"}
          </button>
        </form>
        {step === "verify" ? (
          <button
            className="button-link login-secondary-action"
            type="button"
            disabled={pending}
            onClick={() => {
              setStep("request");
              setOtp("");
              setFeedback(null);
            }}
          >
            Use another Telegram id
          </button>
        ) : null}
      </SurfaceCard>
    </div>
  );
}
