import { useCallback } from "react";
import { getPromptCacheLatest } from "../api/client";
import type { PromptCacheLatestResponse } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RefreshButton } from "../components/RefreshButton";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatNumber, formatPercent, formatUnknown } from "../lib/format";

export function CacheScreen() {
  const loadCache = useCallback(() => getPromptCacheLatest(), []);
  const { state, retry } = useAsyncResource<PromptCacheLatestResponse>(loadCache);

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading cache telemetry" description="Reading the latest prompt cache observation." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Cache telemetry unavailable" description={state.error.message} onRetry={retry} />;
  }

  const latest = state.data.latest;

  if (!latest) {
    return (
      <div className="screen-stack">
        <PageHeader
          eyebrow="Cache"
          title="Latest prompt cache telemetry"
          description="Read-only latest cache observation from `/api/debug/prompt-cache/latest`."
          actions={<RefreshButton onClick={retry} />}
        />
        <EmptyState
          title="No cache telemetry yet"
          description="Cache telemetry will appear after compatible requests are processed."
        />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Cache"
        title="Latest prompt cache telemetry"
        description="Most recent cache observation reported by the backend."
        actions={<RefreshButton onClick={retry} />}
      />

      <SurfaceCard>
        <div className="hero-status">
          <div>
            <p className="eyebrow">Latest observation</p>
            <h2>{formatUnknown(latest.providerId)}</h2>
            <p>{formatDateTime(latest.timestamp)}</p>
          </div>
          <StatusBadge variant={latest.cacheHit ? "success" : "neutral"}>
            {latest.cacheHit ? "Cache hit" : "Observed"}
          </StatusBadge>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Telemetry details" description="Only fields reported by the backend are shown.">
        <dl className="detail-list">
          <div><dt>Request ID</dt><dd>{formatUnknown(latest.requestId)}</dd></div>
          <div><dt>Model</dt><dd>{formatUnknown(latest.model)}</dd></div>
          <div><dt>Cache key</dt><dd>{formatUnknown(latest.promptCacheKey)}</dd></div>
          <div><dt>Retention</dt><dd>{formatUnknown(latest.promptCacheRetention)}</dd></div>
          <div><dt>Cached token count</dt><dd>{formatNumber(latest.cachedTokens)}</dd></div>
          <div><dt>Saved percentage</dt><dd>{formatPercent(latest.cacheSavedPercent)}</dd></div>
          <div><dt>Target</dt><dd>{formatUnknown(latest.upstreamTarget)}</dd></div>
          <div><dt>Truncation</dt><dd>{formatUnknown(latest.truncation)}</dd></div>
          <div><dt>Reasoning effort</dt><dd>{formatUnknown(latest.reasoningEffort)}</dd></div>
          <div><dt>Reasoning summary</dt><dd>{formatUnknown(latest.reasoningSummary)}</dd></div>
          <div><dt>Text verbosity</dt><dd>{formatUnknown(latest.textVerbosity)}</dd></div>
        </dl>
      </SurfaceCard>
    </div>
  );
}
