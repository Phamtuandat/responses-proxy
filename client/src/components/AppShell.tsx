import type { ReactNode } from "react";
import type { AppRoute, NavItem, Theme } from "../App";
import { Sidebar } from "./Sidebar";
import { TopToolbar } from "./TopToolbar";

type AppShellProps = {
  currentRoute: AppRoute;
  navItems: NavItem[];
  theme: Theme;
  onToggleTheme: () => void;
  children: ReactNode;
};

export function AppShell({
  currentRoute,
  navItems,
  theme,
  onToggleTheme,
  children,
}: AppShellProps) {
  return (
    <div className="app-page">
      <main className="app-panel">
        <div className="app-shell">
          <Sidebar currentRoute={currentRoute} navItems={navItems} />
          <section className="content-area" aria-label="React migration shell">
            <TopToolbar theme={theme} onToggleTheme={onToggleTheme} />
            <div className="screen-frame">{children}</div>
          </section>
        </div>
      </main>
    </div>
  );
}
