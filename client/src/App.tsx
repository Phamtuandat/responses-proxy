import type { ComponentType, SVGProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDashboardAuthSession, logoutDashboard } from "./api/client";
import type { DashboardAuthSession } from "./api/types";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/EmptyState";
import { LoadingState } from "./components/LoadingState";
import { NotificationProvider } from "./components/feedback/NotificationProvider";
import { AccountManagementScreen } from "./screens/AccountManagementScreen";
import { AuthScreen } from "./screens/AuthScreen";
import { CacheScreen } from "./screens/CacheScreen";
import { ConsoleLogScreen } from "./screens/ConsoleLogScreen";
import { ClientsScreen } from "./screens/ClientsScreen";
import { CombosScreen } from "./screens/CombosScreen";
import { ConfigHelperScreen } from "./screens/ConfigHelperScreen";
import { DashboardScreen } from "./screens/DashboardScreen";
import { EnhancedDashboardScreen } from "./screens/EnhancedDashboardScreen";
import { EndpointScreen } from "./screens/EndpointScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { ProvidersScreen } from "./screens/ProvidersScreen";
import { EnhancedProvidersScreen, MediaProvidersScreen, ProxyPoolsScreen } from "./screens/EnhancedProvidersScreen";
import { ProviderDetailScreen } from "./screens/ProviderDetailScreen";
import { ProviderNewScreen } from "./screens/ProviderNewScreen";
import { RtkScreen } from "./screens/RtkScreen";
import { UsageScreen } from "./screens/UsageScreen";
import { flatNavItems, routerFlatNavItems, routeAliases, resolveRouteAlias } from "./navigation/FunctionalNavigation";

export type AppRoute =
  | "dashboard"
  | "providers"
  | "provider-new"
  | "provider-detail"
  | "clients"
  | "client-detail"
  | "oauth"
  | "account-detail"
  | "kiro"
  | "kiro-detail"
  | "auth-management"
  | "config-helper"
  | "usage"
  | "rtk"
  | "cache"
  // New router-focused routes
  | "endpoint"
  | "combos"
  | "quota-tracker"
  | "mitm"
  | "cli-tools"
  | "media-providers"
  | "proxy-pools"
  | "skills"
  | "console-log"
  | "settings";

export type NavRoute =
  | "dashboard"
  | "providers"
  | "clients"
  | "oauth"
  | "kiro"
  | "auth-management"
  | "config-helper"
  | "usage"
  | "rtk"
  | "cache"
  // New router-focused routes
  | "endpoint"
  | "combos"
  | "quota-tracker"
  | "mitm"
  | "cli-tools"
  | "media-providers"
  | "proxy-pools"
  | "skills"
  | "console-log"
  | "settings";

export type Theme = "light" | "dark";

type RouteState = {
  route: AppRoute;
  baseRoute: NavRoute;
  params: Record<string, string>;
  isUnknown: boolean;
};

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; session: DashboardAuthSession }
  | { status: "anonymous" };

const THEME_STORAGE_KEY = "responses-proxy-theme";
const DEFAULT_ROUTE: NavRoute = "endpoint"; // Default to endpoint for router-focused UI

// Create navRouteSet from both functional navigation and router navigation
const allNavItems = [...flatNavItems, ...routerFlatNavItems];
const navRouteSet = new Set<NavRoute>(allNavItems.map((item) => item.route));

// Add route aliases to the set
Object.keys(routeAliases).forEach(alias => {
  const resolvedRoute = resolveRouteAlias(alias);
  if (resolvedRoute) {
    navRouteSet.add(resolvedRoute);
  }
});

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
  let baseRoute = segments[0];

  if (!baseRoute) {
    return { route: DEFAULT_ROUTE, baseRoute: DEFAULT_ROUTE, params: {}, isUnknown: false };
  }

  // Try to resolve route alias first
  const resolvedRoute = resolveRouteAlias(baseRoute);
  if (resolvedRoute) {
    baseRoute = resolvedRoute;
  }

  if (!navRouteSet.has(baseRoute as NavRoute)) {
    return { route: DEFAULT_ROUTE, baseRoute: DEFAULT_ROUTE, params: {}, isUnknown: true };
  }

  const resolvedBaseRoute = baseRoute as NavRoute;
  const detailId = segments[1] ? decodeRouteParam(segments[1]) : "";

  if (resolvedBaseRoute === "providers") {
    // 9router-style dedicated add page: #/providers/new
    if (detailId === "new") {
      return {
        route: "provider-new",
        baseRoute: resolvedBaseRoute,
        params: {},
        isUnknown: segments.length > 2,
      };
    }
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

  if (resolvedBaseRoute === "kiro") {
    // Redirect kiro routes to oauth with kiro tab
    return {
      route: detailId ? "account-detail" : "oauth",
      baseRoute: "oauth" as NavRoute,
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
        description="This dashboard uses the current React route map. Return to Endpoint to continue."
        actionHref="#/endpoint"
        actionLabel="Go to Endpoint"
      />
    );
  }

  switch (routeState.route) {
    // Router-focused routes
    case "endpoint":
      return <EndpointScreen />;
    case "combos":
      return <CombosScreen />;
    case "quota-tracker":
      return <UsageScreen />;
    case "mitm":
      return <CacheScreen />;
    case "cli-tools":
      return <ConfigHelperScreen />;
    case "media-providers":
      return <MediaProvidersScreen />;
    case "proxy-pools":
      return <ProxyPoolsScreen />;
    case "skills":
      return <RtkScreen />;
    case "console-log":
      return <ConsoleLogScreen />;
    case "settings":
      return <AuthScreen />;

    // Legacy routes
    case "providers":
      return <EnhancedProvidersScreen />;
    case "provider-new":
      return <ProviderNewScreen />;
    case "provider-detail":
      return <ProviderDetailScreen providerId={routeState.params.providerId} />;
    case "clients":
      return <ClientsScreen />;
    case "client-detail":
      return <ClientsScreen clientKey={routeState.params.clientKey} />;
    case "oauth":
      // Determine initial tab based on current hash
      const initialTab = window.location.hash.includes('/kiro') ? 'kiro' : 'oauth';
      return <AccountManagementScreen initialTab={initialTab} />;
    case "account-detail":
      return <AccountManagementScreen accountId={routeState.params.accountId} />;
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
      return <EnhancedDashboardScreen />;
    default:
      return <EndpointScreen />;
  }
}

export function App() {
  const [routeState, setRouteState] = useState<RouteState>(readRouteFromHash);
  const [theme, setTheme] = useState<Theme>(readInitialTheme);
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });

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
    let cancelled = false;
    getDashboardAuthSession()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setAuthState(result.authenticated && result.session ? { status: "authenticated", session: result.session } : { status: "anonymous" });
      })
      .catch(() => {
        if (!cancelled) {
          setAuthState({ status: "anonymous" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/endpoint");
    }

    const handleHashChange = () => setRouteState(readRouteFromHash());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);

  const handleLogout = useCallback(async () => {
    await logoutDashboard().catch(() => undefined);
    setAuthState({ status: "anonymous" });
  }, []);

  const handleNavigate = useCallback((route: NavRoute) => {
    // Update the URL hash to trigger navigation
    window.location.hash = `#/${route}`;
  }, []);

  const screen = useMemo(() => renderScreen(routeState), [routeState]);

  if (authState.status === "loading") {
    return (
      <div className="app-page">
        <main className="app-panel">
          <LoadingState title="Checking dashboard login" description="Validating your admin session." cards={3} />
        </main>
      </div>
    );
  }

  if (authState.status === "anonymous") {
    return <LoginScreen onAuthenticated={(session) => setAuthState({ status: "authenticated", session })} />;
  }

  return (
    <NotificationProvider>
      <AppShell
        currentRoute={routeState.baseRoute}
        theme={theme}
        session={authState.session}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
        onNavigate={handleNavigate}
      >
        {screen}
      </AppShell>
    </NotificationProvider>
  );
}
