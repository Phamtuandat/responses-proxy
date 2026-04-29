import type { AppRoute, NavItem } from "../App";

type SidebarProps = {
  currentRoute: AppRoute;
  navItems: NavItem[];
};

export function Sidebar({ currentRoute, navItems }: SidebarProps) {
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

      <nav className="side-nav">
        <span className="nav-section-label">Workspace</span>
        {navItems.map((item) => (
          <a
            aria-current={item.route === currentRoute ? "page" : undefined}
            className={item.route === currentRoute ? "active" : undefined}
            href={`#/${item.route}`}
            key={item.route}
          >
            <span className="nav-indicator" aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
}
