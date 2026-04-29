import type { Theme } from "../App";
import { ThemeToggle } from "./ThemeToggle";

type TopToolbarProps = {
  theme: Theme;
  onToggleTheme: () => void;
};

export function TopToolbar({ theme, onToggleTheme }: TopToolbarProps) {
  return (
    <header className="top-toolbar">
      <div>
        <p className="eyebrow">Workspace</p>
        <p className="toolbar-copy">Monitor routing, tune providers, and manage client access from the live control plane.</p>
      </div>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    </header>
  );
}
