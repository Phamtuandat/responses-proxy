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
        <p className="eyebrow">Phase 2</p>
        <p className="toolbar-copy">React shell only. Production still serves the legacy UI.</p>
      </div>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    </header>
  );
}
