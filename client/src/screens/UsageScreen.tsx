import { useEffect, useState } from "react";
import { getUsageStats } from "../api/client";
import type { UsageStatsResponse } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { SurfaceCard } from "../components/SurfaceCard";

export function UsageScreen() {
  const [stats, setStats] = useState<UsageStatsResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    getUsageStats()
      .then((data) => {
        if (isMounted) setStats(data);
      })
      .catch((caughtError: unknown) => {
        if (isMounted) {
          setError(caughtError instanceof Error ? caughtError.message : "Unable to load usage stats");
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  if (error) {
    return <EmptyState title="Usage" description={error} />;
  }

  return (
    <SurfaceCard
      title="Usage"
      description="Read-only usage preview. Detailed tables remain in the legacy dashboard during Phase 2."
    >
      <pre className="json-preview">{stats ? JSON.stringify(stats, null, 2) : "Loading..."}</pre>
    </SurfaceCard>
  );
}
