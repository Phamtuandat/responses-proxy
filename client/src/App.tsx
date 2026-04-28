import type { CSSProperties } from "react";

const styles = {
  page: {
    minHeight: "100vh",
    margin: 0,
    display: "grid",
    placeItems: "center",
    padding: "24px",
    color: "rgba(29, 29, 31, 0.92)",
    background:
      "radial-gradient(circle at 24% 0%, rgba(255,255,255,0.92), transparent 34%), linear-gradient(180deg, #f5f5f7 0%, #eceef2 100%)",
    fontFamily:
      '"SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  },
  card: {
    width: "min(100%, 560px)",
    padding: "32px",
    borderRadius: "32px",
    border: "1px solid rgba(20, 20, 24, 0.08)",
    background: "rgba(255, 255, 255, 0.72)",
    boxShadow: "0 24px 70px rgba(0, 0, 0, 0.1)",
    backdropFilter: "blur(28px) saturate(130%)",
  },
  eyebrow: {
    margin: "0 0 12px",
    color: "rgba(29, 29, 31, 0.56)",
    fontSize: "13px",
    fontWeight: 650,
  },
  title: {
    margin: 0,
    fontSize: "clamp(34px, 6vw, 52px)",
    lineHeight: 1,
    letterSpacing: "-0.02em",
  },
  copy: {
    margin: "16px 0 0",
    color: "rgba(29, 29, 31, 0.62)",
    fontSize: "16px",
    lineHeight: 1.55,
  },
} satisfies Record<string, CSSProperties>;

export function App() {
  return (
    <main style={styles.page}>
      <section style={styles.card} aria-labelledby="react-shell-title">
        <p style={styles.eyebrow}>Responses Proxy</p>
        <h1 id="react-shell-title" style={styles.title}>
          React shell ready
        </h1>
        <p style={styles.copy}>
          Phase 1 is isolated from the production static dashboard. No API calls
          or existing UI behavior are wired into this shell yet.
        </p>
      </section>
    </main>
  );
}
