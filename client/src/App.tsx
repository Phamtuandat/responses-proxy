import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { AccountsScreen } from "./screens/AccountsScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { CacheScreen } from "./screens/CacheScreen";
import { ClientsScreen } from "./screens/ClientsScreen";
import { ConfigHelperScreen } from "./screens/ConfigHelperScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { ProvidersScreen } from "./screens/ProvidersScreen";
import { RtkScreen } from "./screens/RtkScreen";
import { UsageScreen } from "./screens/UsageScreen";

export type AppRoute =
  | "dashboard"
  | "providers"
  | "clients"
  | "oauth"
  | "auth-management"
  | "config-helper"
  | "usage"
  | "rtk"
  | "cache";

export type Theme = "light" | "dark";

export type NavItem = {
  route: AppRoute;
  label: string;
};

const THEME_STORAGE_KEY = "responses-proxy-theme";
const DEFAULT_ROUTE: AppRoute = "dashboard";

const navItems: NavItem[] = [
  { route: "dashboard", label: "Dashboard" },
  { route: "providers", label: "Providers" },
  { route: "clients", label: "Clients" },
  { route: "oauth", label: "Accounts" },
  { route: "auth-management", label: "Auth" },
  { route: "config-helper", label: "Config" },
  { route: "usage", label: "Usage" },
  { route: "rtk", label: "RTK" },
  { route: "cache", label: "Cache" },
];

const routeSet = new Set<AppRoute>(navItems.map((item) => item.route));

function readRouteFromHash(): { route: AppRoute; isUnknown: boolean } {
  const route = window.location.hash.replace(/^#\/?/, "").trim();

  if (routeSet.has(route as AppRoute)) {
    return { route: route as AppRoute, isUnknown: false };
  }

  return { route: DEFAULT_ROUTE, isUnknown: route.length > 0 };
}

function readInitialTheme(): Theme {
  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch {
    // Ignore storage access failures and keep the shell deterministic.
  }

  return "light";
}

function renderScreen(route: AppRoute, isUnknown: boolean) {
  if (isUnknown) {
    return (
      <EmptyState
        title="Route not found"
        description="This React shell mirrors the legacy dashboard routes. Return to Dashboard to continue."
        actionHref="#/dashboard"
        actionLabel="Go to Dashboard"
      />
    );
  }

  switch (route) {
    case "providers":
      return <ProvidersScreen />;
    case "clients":
      return <ClientsScreen />;
    case "oauth":
      return <AccountsScreen />;
    case "auth-management":
      return <AuthScreen />;
    case "config-helper":
      return <ConfigHelperScreen />;
    case "usage":
      return <UsageScreen />;
    case "rtk":
      return <RtkScreen />;
    case "cache":
      return <CacheScreen />;
    case "dashboard":
    default:
      return <DashboardScreen />;
  }
}

export function App() {
  const [routeState, setRouteState] = useState(readRouteFromHash);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme persistence is progressive enhancement.
    }
  }, [theme]);

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/dashboard");
    }

    const handleHashChange = () => setRouteState(readRouteFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);

  const screen = useMemo(
    () => renderScreen(routeState.route, routeState.isUnknown),
    [routeState],
  );

  return (
    <AppShell
      currentRoute={routeState.route}
      navItems={navItems}
      theme={theme}
      onToggleTheme={toggleTheme}
    >
      {screen}
    </AppShell>
  );
}
