import type { ReactNode } from "react";
import { useState } from "react";
import type { DashboardAuthSession } from "../api/types";
import type { NavRoute, Theme } from "../App";
import { flatNavItems, getActiveTab, getTabById, tabNavigation } from "../navigation/FunctionalNavigation";
import { Sidebar } from "./Sidebar";
import { TopToolbar } from "./TopToolbar";
import { TabNavigation } from "./TabNavigation";
import { MiniSidebar } from "./MiniSidebar";

type AppShellProps = {
  currentRoute: NavRoute;
  theme: Theme;
  session: DashboardAuthSession;
  onToggleTheme: () => void;
  onLogout: () => void;
  onNavigate: (route: NavRoute) => void;
  children: ReactNode;
  useTabLayout?: boolean; // Feature flag for gradual rollout
};

export function AppShell({
  currentRoute,
  theme,
  session,
  onToggleTheme,
  onLogout,
  onNavigate,
  children,
  useTabLayout = true, // Default to new layout
}: AppShellProps) {
  const [contextualPanelVisible, setContextualPanelVisible] = useState(false);

  const currentLabel = flatNavItems.find((item) => item.route === currentRoute)?.label ?? "Dashboard";
  const activeTabId = getActiveTab(currentRoute);

  const handleTabChange = (tabId: string) => {
    const tab = getTabById(tabId);
    if (!tab) return;

    // Navigate to the tab's primary route
    if (tab.route) {
      // Single-section tab (like Overview)
      onNavigate(tab.route);
    } else if (tab.sections.length > 0) {
      // Multi-section tab - navigate to first section's first item
      const firstSection = tab.sections[0];
      const firstItem = firstSection.items[0];
      if (firstItem) {
        onNavigate(firstItem.route);
      }
    }
  };

  const handleSectionChange = (sectionId: string, itemRoute: NavRoute) => {
    onNavigate(itemRoute);
  };

  // Legacy layout for backward compatibility
  if (!useTabLayout) {
    return (
      <div className="app-page">
        <main className="app-panel">
          <div className="app-shell">
            <Sidebar currentRoute={currentRoute} />
            <section className="content-area" aria-label="Dashboard content">
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

  // New tab-based layout
  return (
    <div className="app-page">
      <main className="app-panel">
        <div className="app-shell-tab-layout">
          <TabNavigation
            currentRoute={currentRoute}
            onTabChange={handleTabChange}
          />

          {activeTabId && (
            <MiniSidebar
              activeTabId={activeTabId}
              currentRoute={currentRoute}
              onSectionChange={handleSectionChange}
            />
          )}

          <section className="main-content" aria-label="Main content">
            <TopToolbar
              currentLabel={currentLabel}
              theme={theme}
              session={session}
              onToggleTheme={onToggleTheme}
              onLogout={onLogout}
            />
            <div className="screen-frame">{children}</div>
          </section>

          {/* Contextual panel - hidden by default, can be shown for configuration */}
          <aside
            className={`contextual-panel ${contextualPanelVisible ? 'visible' : ''}`}
            aria-label="Contextual actions"
          >
            <div className="contextual-panel-content">
              {/* Contextual content will be added in future iterations */}
              <div className="contextual-panel-placeholder">
                <p>Quick actions and configuration options will appear here.</p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
