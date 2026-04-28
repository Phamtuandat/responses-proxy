import { useEffect, useState } from "react";
import { getHealth } from "../api/client";
import type { HealthResponse } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { StatCard } from "../components/StatCard";
import { SurfaceCard } from "../components/SurfaceCard";

type LoadState =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ready"; data: HealthResponse; error?: undefined }
  | { status: "error"; data?: undefined; error: string };

export function DashboardScreen() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let isMounted = true;

    getHealth()
      .then((data) => {
        if (isMounted) {
          setState({ status: "ready", data });
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setState({
            status: "error",
            error: error instanceof Error ? error.message : "Unable to load health",
          });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (state.status === "loading") {
    return (
      <EmptyState
        title="Loading dashboard"
        description="Reading the existing Fastify health endpoint."
      />
    );
  }

  if (state.status === "error") {
    return (
      <EmptyState
        title="Health check unavailable"
        description={state.error}
      />
    );
  }

  return (
    <div className="screen-stack">
      <section className="screen-hero">
        <p className="eyebrow">Dashboard</p>
        <h2>React shell ready for incremental migration.</h2>
        <p>
          This screen reads `/health` only. CRUD, OAuth, and write flows remain
          in the legacy public dashboard until later phases.
        </p>
      </section>

      <div className="stat-grid">
        <StatCard label="Service" value={state.data.service ?? "responses-proxy"} />
        <StatCard label="Status" value={state.data.ok ? "Healthy" : "Check"} />
        <StatCard
          label="Active provider"
          value={state.data.activeProviderId ?? "Not reported"}
        />
      </div>

      <SurfaceCard title="Runtime status" description="Read-only status from Fastify.">
        <dl className="detail-list">
          <div>
            <dt>Upstream</dt>
            <dd>{state.data.upstream ?? "Not reported"}</dd>
          </div>
          <div>
            <dt>Fallback</dt>
            <dd>{state.data.fallback ?? "Not reported"}</dd>
          </div>
        </dl>
      </SurfaceCard>
    </div>
  );
}
