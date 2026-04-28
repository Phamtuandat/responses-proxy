import { useEffect, useState } from "react";
import { getPromptCacheLatest } from "../api/client";
import type { PromptCacheLatestResponse } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { SurfaceCard } from "../components/SurfaceCard";

export function CacheScreen() {
  const [cache, setCache] = useState<PromptCacheLatestResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    getPromptCacheLatest()
      .then((data) => {
        if (isMounted) setCache(data);
      })
      .catch((caughtError: unknown) => {
        if (isMounted) {
          setError(caughtError instanceof Error ? caughtError.message : "Unable to load cache state");
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  if (error) {
    return <EmptyState title="Cache" description={error} />;
  }

  return (
    <SurfaceCard
      title="Cache"
      description="Read-only prompt cache preview. Provider-specific cache tools remain in the legacy dashboard."
    >
      <dl className="detail-list">
        <div>
          <dt>Request</dt>
          <dd>{cache?.requestId ?? "Loading..."}</dd>
        </div>
        <div>
          <dt>Model</dt>
          <dd>{cache?.model ?? "Not reported"}</dd>
        </div>
        <div>
          <dt>Cache key</dt>
          <dd>{cache?.promptCacheKey ?? "Not reported"}</dd>
        </div>
      </dl>
    </SurfaceCard>
  );
}
