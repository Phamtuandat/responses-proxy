import type { NavRoute } from "../App";
import {
  getCurrentFunctionalNavGroups,
  getNavigationMode,
  type FunctionalNavGroup
} from "../navigation/FunctionalNavigation";
import { useNavigationState } from "../hooks/useNavigationState";
import { PowerIcon } from "./icons";

type SidebarProps = {
  currentRoute: NavRoute;
};

function ProductHeader() {
  return (
    <header className="sidebar-product-header">
      {/* macOS-style window dots */}
      <div className="window-dots" aria-hidden="true">
        <div className="window-dot window-dot-close"></div>
        <div className="window-dot window-dot-minimize"></div>
        <div className="window-dot window-dot-maximize"></div>
      </div>

      <div className="product-info">
        <div className="product-mark" aria-hidden="true">
          RP
        </div>
        <div className="product-details">
          <h1 className="product-name">Responses Proxy</h1>
          <p className="product-version">v0.1.0</p>
        </div>
      </div>
    </header>
  );
}

function ShutdownButton() {
  const handleShutdown = () => {
    // TODO: Implement shutdown functionality
    console.log('Shutdown requested');
  };

  return (
    <button
      className="shutdown-button"
      onClick={handleShutdown}
      title="Shutdown server"
      aria-label="Shutdown server"
    >
      <PowerIcon />
      <span>Shutdown</span>
    </button>
  );
}

export function Sidebar({ currentRoute }: SidebarProps) {
  const { toggleGroup, isGroupCollapsed } = useNavigationState();
  const navGroups = getCurrentFunctionalNavGroups();
  const isRouterMode = getNavigationMode() === "router";

  const isGroupActive = (group: FunctionalNavGroup): boolean => {
    return group.items.some(item => item.route === currentRoute);
  };

  const handleKeyDown = (e: React.KeyboardEvent, groupId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleGroup(groupId);
    }
  };

  return (
    <aside className="sidebar" aria-label="Navigation">
      <ProductHeader />

      <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
        {navGroups.map((group) => {
          const GroupIcon = group.icon;
          const isActive = isGroupActive(group);
          const isCollapsed = isGroupCollapsed(group.id);
          const canCollapse = group.collapsible !== false;
          const isSystemSection = group.id === "system";

          return (
            <div key={group.id} className={`nav-section ${isSystemSection ? 'nav-section-system' : ''}`}>
              {/* Section Header */}
              <div
                className={`nav-section-header ${isActive ? 'active' : ''} ${canCollapse ? 'collapsible' : ''}`}
                onClick={canCollapse ? () => toggleGroup(group.id) : undefined}
                role={canCollapse ? "button" : undefined}
                tabIndex={canCollapse ? 0 : undefined}
                onKeyDown={canCollapse ? (e) => handleKeyDown(e, group.id) : undefined}
                aria-expanded={canCollapse ? !isCollapsed : undefined}
                aria-controls={canCollapse ? `nav-section-${group.id}` : undefined}
              >
                <span className="nav-section-icon" aria-hidden="true">
                  <GroupIcon />
                </span>
                <span className="nav-section-label">{group.label}</span>
                {canCollapse && (
                  <span
                    className={`nav-collapse-icon ${isCollapsed ? 'collapsed' : 'expanded'}`}
                    aria-hidden="true"
                  >
                    ▼
                  </span>
                )}
              </div>

              {/* Section Items */}
              {(!canCollapse || !isCollapsed) && (
                <div
                  className="nav-section-items"
                  id={canCollapse ? `nav-section-${group.id}` : undefined}
                >
                  {group.items.map((item) => {
                    const ItemIcon = item.icon;
                    const isItemActive = item.route === currentRoute;

                    return (
                      <a
                        key={item.route}
                        href={`#/${item.route}`}
                        className={`nav-item ${isItemActive ? 'active' : ''}`}
                        aria-current={isItemActive ? "page" : undefined}
                        title={item.description}
                      >
                        <span className="nav-item-icon" aria-hidden="true">
                          <ItemIcon />
                        </span>
                        <span className="nav-item-label">{item.label}</span>
                        {item.badge && (
                          <span className="nav-item-badge" aria-label={`${item.badge} feature`}>
                            {item.badge}
                          </span>
                        )}
                      </a>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <ShutdownButton />
      </div>
    </aside>
  );
}
