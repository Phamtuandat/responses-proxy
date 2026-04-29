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
  | "provider-detail"
  | "clients"
  | "client-detail"
  | "oauth"
  | "account-detail"
  | "auth-management"
  | "config-helper"
  | "usage"
  | "rtk"
  | "cache";

export type NavRoute =
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
  route: NavRoute;
  label: string;
};

type RouteState = {
  route: AppRoute;
  baseRoute: NavRoute;
  params: Record<string, string>;
  isUnknown: boolean;
};

const THEME_STORAGE_KEY = "responses-proxy-theme";
const DEFAULT_ROUTE: NavRoute = "dashboard";

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

const navRouteSet = new Set<NavRoute>(navItems.map((item) => item.route));

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readRouteFromHash(): RouteState {
  const raw = window.location.hash.replace(/^#\/?/, "").trim();
  const segments = raw.split("/").filter(Boolean);
  const baseRoute = segments[0];

  if (!baseRoute) {
    return {
      route: DEFAULT_ROUTE,
      baseRoute: DEFAULT_ROUTE,
      params: {},
      isUnknown: false,
    };
  }

  if (!navRouteSet.has(baseRoute as NavRoute)) {
    return {
      route: DEFAULT_ROUTE,
      baseRoute: DEFAULT_ROUTE,
      params: {},
      isUnknown: true,
    };
  }

  const resolvedBaseRoute = baseRoute as NavRoute;
  const detailId = segments[1] ? decodeRouteParam(segments[1]) : "";

  if (resolvedBaseRoute === "providers") {
    return {
      route: detailId ? "provider-detail" : "providers",
      baseRoute: resolvedBaseRoute,
      params: detailId ? { providerId: detailId } : {},
      isUnknown: segments.length > 2,
    };
  }

  if (resolvedBaseRoute === "clients") {
    return {
      route: detailId ? "client-detail" : "clients",
      baseRoute: resolvedBaseRoute,
      params: detailId ? { clientKey: detailId } : {},
      isUnknown: segments.length > 2,
    };
  }

  if (resolvedBaseRoute === "oauth") {
    return {
      route: detailId ? "account-detail" : "oauth",
      baseRoute: resolvedBaseRoute,
      params: detailId ? { accountId: detailId } : {},
      isUnknown: segments.length > 2,
    };
  }

  return {
    route: resolvedBaseRoute,
    baseRoute: resolvedBaseRoute,
    params: {},
    isUnknown: segments.length > 1,
  };
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

function renderScreen(routeState: RouteState) {
  if (routeState.isUnknown) {
    return (
      <EmptyState
        title="Route not found"
        description="This dashboard uses the current React route map. Return to Dashboard to continue."
        actionHref="#/dashboard"
        actionLabel="Go to Dashboard"
      />
    );
  }

  switch (routeState.route) {
    case "providers":
      return <ProvidersScreen />;
    case "provider-detail":
      return <ProvidersScreen providerId={routeState.params.providerId} />;
    case "clients":
      return <ClientsScreen />;
    case "client-detail":
      return <ClientsScreen clientKey={routeState.params.clientKey} />;
    case "oauth":
      return <AccountsScreen />;
    case "account-detail":
      return <AccountsScreen accountId={routeState.params.accountId} />;
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
  const [routeState, setRouteState] = useState<RouteState>(readRouteFromHash);
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

  const screen = useMemo(() => renderScreen(routeState), [routeState]);

  return (
    <AppShell
      currentRoute={routeState.baseRoute}
      navItems={navItems}
      theme={theme}
      onToggleTheme={toggleTheme}
    >
      {screen}
    </AppShell>
  );
}
