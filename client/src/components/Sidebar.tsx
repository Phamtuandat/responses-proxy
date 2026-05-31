import type { NavRoute } from "../App";
import { functionalNavGroups, type FunctionalNavGroup } from "../navigation/FunctionalNavigation";
import { useNavigationState } from "../hooks/useNavigationState";

type SidebarProps = {
  currentRoute: NavRoute;
};

export function Sidebar({ currentRoute }: SidebarProps) {
  const { toggleGroup, isGroupCollapsed } = useNavigationState();

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
    <aside className="sidebar" aria-label="Sections">
      <header className="brand-card">
        <div className="brand-mark" aria-hidden="true">
          RP
        </div>
        <div>
          <p className="eyebrow">Responses Proxy</p>
          <h1>Control plane</h1>
          <p className="brand-copy">Routing, accounts, usage, and workspace controls in one calm workspace.</p>
        </div>
      </header>

      <nav className="side-nav" role="navigation" aria-label="Main navigation">
        <span className="nav-section-label">Workspace</span>

        {functionalNavGroups.map((group) => {
          const GroupIcon = group.icon;
          const isActive = isGroupActive(group);
          const isCollapsed = isGroupCollapsed(group.id);
          const canCollapse = group.collapsible !== false;

          return (
            <div key={group.id} className="nav-group">
              {/* Group Header */}
              <div
                className={`nav-group-header ${isActive ? 'active' : ''} ${canCollapse ? 'collapsible' : ''}`}
                onClick={canCollapse ? () => toggleGroup(group.id) : undefined}
                role={canCollapse ? "button" : undefined}
                tabIndex={canCollapse ? 0 : undefined}
                onKeyDown={canCollapse ? (e) => handleKeyDown(e, group.id) : undefined}
                aria-expanded={canCollapse ? !isCollapsed : undefined}
                aria-controls={canCollapse ? `nav-group-${group.id}` : undefined}
              >
                <span className="nav-icon" aria-hidden="true">
                  <GroupIcon />
                </span>
                <span className="nav-label">{group.label}</span>
                {canCollapse && (
                  <span
                    className={`nav-collapse-icon ${isCollapsed ? 'collapsed' : 'expanded'}`}
                    aria-hidden="true"
                  >
                    ▼
                  </span>
                )}
              </div>

              {/* Group Items */}
              {(!canCollapse || !isCollapsed) && (
                <div
                  className="nav-group-items"
                  id={canCollapse ? `nav-group-${group.id}` : undefined}
                >
                  {group.items.map((item) => {
                    const ItemIcon = item.icon;
                    const isItemActive = item.route === currentRoute;

                    return (
                      <a
                        key={item.route}
                        href={`#/${item.route}`}
                        className={`nav-group-item ${isItemActive ? 'active' : ''}`}
                        aria-current={isItemActive ? "page" : undefined}
                        title={item.description}
                      >
                        <span className="nav-icon" aria-hidden="true">
                          <ItemIcon />
                        </span>
                        <span className="nav-label">{item.label}</span>
                        {item.badge && (
                          <span className="nav-badge" aria-label={`${item.badge} feature`}>
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
    </aside>
  );
}
