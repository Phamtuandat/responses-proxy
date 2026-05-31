import type { DashboardAuthSession } from "../api/types";
import type { Theme } from "../App";
import { LogoutIcon } from "./icons";
import { ThemeToggle } from "./ThemeToggle";

type TopToolbarProps = {
  currentLabel: string;
  theme: Theme;
  session: DashboardAuthSession;
  onToggleTheme: () => void;
  onLogout: () => void;
};

export function TopToolbar({ currentLabel, theme, session, onToggleTheme, onLogout }: TopToolbarProps) {
  return (
    <header className="top-toolbar">
      <nav className="toolbar-breadcrumb" aria-label="Breadcrumb">
        <span className="crumb-root">Workspace</span>
        <span className="crumb-sep" aria-hidden="true">/</span>
        <span className="crumb-current">{currentLabel}</span>
      </nav>
      <div className="toolbar-actions">
        <span className="toolbar-session">Telegram {session.telegramUserId}</span>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <button type="button" className="button-link" onClick={onLogout}>
          <LogoutIcon width={16} height={16} />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
