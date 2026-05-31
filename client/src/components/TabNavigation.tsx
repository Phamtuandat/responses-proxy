import { tabNavigation, getActiveTab, type NavRoute } from "../navigation/FunctionalNavigation";

type TabNavigationProps = {
  currentRoute: NavRoute;
  onTabChange: (tabId: string) => void;
};

export function TabNavigation({ currentRoute, onTabChange }: TabNavigationProps) {
  const activeTabId = getActiveTab(currentRoute);

  return (
    <nav className="tab-navigation" role="navigation" aria-label="Main navigation">
      <div className="tab-navigation-container">
        <div className="tab-list" role="tablist">
          {tabNavigation.map((tab) => {
            const isActive = activeTabId === tab.id;

            return (
              <button
                key={tab.id}
                className={`tab-button ${isActive ? 'tab-button-active' : ''}`}
                onClick={() => onTabChange(tab.id)}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
              >
                <tab.icon className="tab-icon" aria-hidden="true" />
                <span className="tab-label">{tab.label}</span>

                {/* Status indicator for tabs with sections */}
                {tab.sections.length > 0 && (
                  <div className="tab-status-indicators">
                    {tab.sections.some(section => section.statusIndicator === 'error') && (
                      <div className="status-dot status-error" aria-label="Error status" />
                    )}
                    {tab.sections.some(section => section.statusIndicator === 'warning') && (
                      <div className="status-dot status-warning" aria-label="Warning status" />
                    )}
                    {tab.sections.every(section => section.statusIndicator === 'healthy') && (
                      <div className="status-dot status-healthy" aria-label="Healthy status" />
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}