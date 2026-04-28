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
        <p className="eyebrow">Phase 3</p>
        <p className="toolbar-copy">Read-only React views are live in dev/build artifacts. Production still serves the legacy UI.</p>
      </div>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
    </header>
  );
}
