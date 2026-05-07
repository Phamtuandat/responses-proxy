import type { DashboardAuthSession } from "../api/types";
import type { Theme } from "../App";
import { ThemeToggle } from "./ThemeToggle";

type TopToolbarProps = {
  theme: Theme;
  session: DashboardAuthSession;
  onToggleTheme: () => void;
  onLogout: () => void;
};

export function TopToolbar({ theme, session, onToggleTheme, onLogout }: TopToolbarProps) {
  return (
    <header className="top-toolbar">
      <div>
        <p className="eyebrow">Workspace</p>
        <p className="toolbar-copy">Monitor routing, tune providers, and manage client access from the live control plane.</p>
        <p className="toolbar-session">Signed in as Telegram {session.telegramUserId}</p>
      </div>
      <div className="toolbar-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <button type="button" className="button-link" onClick={onLogout}>Logout</button>
      </div>
    </header>
  );
}
