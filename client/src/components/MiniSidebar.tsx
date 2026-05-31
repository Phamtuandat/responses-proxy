import { getTabById, getActiveSection, type NavRoute } from "../navigation/FunctionalNavigation";

type MiniSidebarProps = {
  activeTabId: string;
  currentRoute: NavRoute;
  onSectionChange: (sectionId: string, itemRoute: NavRoute) => void;
};

export function MiniSidebar({ activeTabId, currentRoute, onSectionChange }: MiniSidebarProps) {
  const activeTab = getTabById(activeTabId);
  const activeSectionId = getActiveSection(currentRoute);

  if (!activeTab || activeTab.sections.length === 0) {
    return null;
  }

  return (
    <aside className="mini-sidebar" role="complementary" aria-label="Section navigation">
      <div className="mini-sidebar-container">
        <nav className="mini-sidebar-nav">
          {activeTab.sections.map((section) => {
            const isActive = activeSectionId === section.id;
            const primaryItem = section.items[0]; // Use first item as primary navigation target

            return (
              <div key={section.id} className="mini-sidebar-section">
                <button
                  className={`mini-sidebar-button ${isActive ? 'mini-sidebar-button-active' : ''}`}
                  onClick={() => onSectionChange(section.id, primaryItem.route)}
                  aria-label={`${section.label}${section.badge ? ` (${section.badge})` : ''}`}
                  title={section.label}
                >
                  <div className="mini-sidebar-icon-container">
                    <section.icon className="mini-sidebar-icon" aria-hidden="true" />

                    {/* Status indicator */}
                    {section.statusIndicator && (
                      <div
                        className={`mini-sidebar-status status-${section.statusIndicator}`}
                        aria-label={`${section.statusIndicator} status`}
                      />
                    )}
                  </div>

                  <div className="mini-sidebar-content">
                    <span className="mini-sidebar-label">{section.label}</span>
                    {section.badge && (
                      <span className="mini-sidebar-badge">{section.badge}</span>
                    )}
                  </div>
                </button>

                {/* Tooltip for collapsed state */}
                <div className="mini-sidebar-tooltip">
                  <div className="mini-sidebar-tooltip-content">
                    <div className="mini-sidebar-tooltip-title">{section.label}</div>
                    {section.badge && (
                      <div className="mini-sidebar-tooltip-badge">{section.badge}</div>
                    )}
                    {section.items.length > 1 && (
                      <div className="mini-sidebar-tooltip-items">
                        {section.items.map(item => (
                          <div key={item.route} className="mini-sidebar-tooltip-item">
                            {item.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}