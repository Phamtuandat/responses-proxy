import type { ReactNode } from "react";
import type { DashboardAuthSession } from "../api/types";
import type { NavRoute, Theme } from "../App";
import {
  flatNavItems,
  routerFlatNavItems,
  getNavigationMode
} from "../navigation/FunctionalNavigation";
import { Sidebar } from "./Sidebar";
import { TopToolbar } from "./TopToolbar";

type AppShellProps = {
  currentRoute: NavRoute;
  theme: Theme;
  session: DashboardAuthSession;
  onToggleTheme: () => void;
  onLogout: () => void;
  children: ReactNode;
};

export function AppShell({
  currentRoute,
  theme,
  session,
  onToggleTheme,
  onLogout,
  children,
}: AppShellProps) {
  const isRouterMode = getNavigationMode() === "router";
  const currentFlatNavItems = isRouterMode ? routerFlatNavItems : flatNavItems;
  const currentLabel = currentFlatNavItems.find((item) => item.route === currentRoute)?.label ?? "Dashboard";

  return (
    <div className="app-page">
      <main className="app-panel">
        <div className="app-shell">
          <Sidebar currentRoute={currentRoute} />
          <section className="content-area" aria-label="Main content">
            <TopToolbar
              currentLabel={currentLabel}
              theme={theme}
              session={session}
              onToggleTheme={onToggleTheme}
              onLogout={onLogout}
            />
            <div className="screen-frame">{children}</div>
          </section>
        </div>
      </main>
    </div>
  );
}
