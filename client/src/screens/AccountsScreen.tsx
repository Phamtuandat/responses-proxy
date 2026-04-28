import { useEffect, useState } from "react";
import { getChatGptOAuthStatus } from "../api/client";
import type { ChatGptOAuthStatusResponse } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { SurfaceCard } from "../components/SurfaceCard";

export function AccountsScreen() {
  const [status, setStatus] = useState<ChatGptOAuthStatusResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    getChatGptOAuthStatus()
      .then((data) => {
        if (isMounted) setStatus(data);
      })
      .catch((caughtError: unknown) => {
        if (isMounted) {
          setError(caughtError instanceof Error ? caughtError.message : "Unable to load OAuth status");
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  if (error) {
    return <EmptyState title="Accounts" description={error} />;
  }

  return (
    <SurfaceCard
      title="Accounts"
      description="Read-only OAuth status preview. Connect, refresh, and delete actions stay in the legacy dashboard for now."
    >
      <dl className="detail-list">
        <div>
          <dt>OAuth enabled</dt>
          <dd>{status ? String(Boolean(status.enabled)) : "Loading..."}</dd>
        </div>
        <div>
          <dt>Accounts</dt>
          <dd>{status?.accounts?.length ?? "Loading..."}</dd>
        </div>
        <div>
          <dt>Rotation</dt>
          <dd>{status?.rotationMode ?? "Not reported"}</dd>
        </div>
      </dl>
    </SurfaceCard>
  );
}
