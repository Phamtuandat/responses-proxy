import type { ReactNode } from "react";
import type { DashboardAuthSession } from "../api/types";
import type { NavItem, NavRoute, Theme } from "../App";
import { Sidebar } from "./Sidebar";
import { TopToolbar } from "./TopToolbar";

type AppShellProps = {
  currentRoute: NavRoute;
  navItems: NavItem[];
  theme: Theme;
  session: DashboardAuthSession;
  onToggleTheme: () => void;
  onLogout: () => void;
  children: ReactNode;
};

export function AppShell({
  currentRoute,
  navItems,
  theme,
  session,
  onToggleTheme,
  onLogout,
  children,
}: AppShellProps) {
  return (
    <div className="app-page">
      <main className="app-panel">
        <div className="app-shell">
          <Sidebar currentRoute={currentRoute} navItems={navItems} />
          <section className="content-area" aria-label="Dashboard content">
            <TopToolbar theme={theme} session={session} onToggleTheme={onToggleTheme} onLogout={onLogout} />
            <div className="screen-frame">{children}</div>
          </section>
        </div>
      </main>
    </div>
  );
}
