import type { ComponentType, SVGProps } from "react";
import {
  AccountsIcon,
  AuthIcon,
  CacheIcon,
  ClientsIcon,
  CliIcon,
  CombosIcon,
  ConfigIcon,
  ConsoleIcon,
  DashboardIcon,
  EndpointIcon,
  MediaIcon,
  MitmIcon,
  PowerIcon,
  ProvidersIcon,
  ProxyPoolIcon,
  QuotaIcon,
  RtkIcon,
  SettingsIcon,
  SkillsIcon,
  UsageIcon,
} from "../components/icons";

// Tab-based navigation structure
export type TabNavigation = {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  sections: NavSection[];
  route?: NavRoute; // For single-section tabs like Overview
};

export type NavSection = {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  items: NavItem[];
  statusIndicator?: 'healthy' | 'warning' | 'error' | 'unknown';
  badge?: string | number;
  collapsible?: boolean;
};

export type NavItem = {
  route: NavRoute;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  description?: string;
  badge?: string | number;
  statusIndicator?: 'healthy' | 'warning' | 'error' | 'unknown';
};

// Legacy functional organization structure (for backward compatibility)
export type FunctionalNavGroup = {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  items: FunctionalNavItem[];
  collapsible?: boolean;
};

export type FunctionalNavItem = {
  route: NavRoute;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  description?: string;
  badge?: string;
};

export type NavRoute =
  | "dashboard"
  | "providers"
  | "provider-detail"
  | "clients"
  | "client-detail"
  | "oauth" // Keep oauth for backward compatibility
  | "account-detail"
  | "auth-management"
  | "config-helper"
  | "usage"
  | "cache"
  | "rtk"
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

// Router-focused navigation structure
export const routerNavigation: TabNavigation[] = [
  {
    id: "main",
    label: "MAIN",
    icon: EndpointIcon,
    sections: [
      {
        id: "endpoint",
        label: "Endpoint",
        icon: EndpointIcon,
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "endpoint",
            label: "Endpoint",
            icon: EndpointIcon,
            description: "Local OpenAI-compatible endpoint and client setup",
            statusIndicator: "healthy"
          }
        ]
      },
      {
        id: "providers",
        label: "Providers",
        icon: ProvidersIcon,
        badge: "3 Active",
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "providers",
            label: "Providers",
            icon: ProvidersIcon,
            description: "Manage AI provider connections",
            statusIndicator: "healthy"
          }
        ]
      },
      {
        id: "combos",
        label: "Combos",
        icon: CombosIcon,
        badge: "12 Routes",
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "combos",
            label: "Combos",
            icon: CombosIcon,
            description: "Routing combinations and fallback chains",
            statusIndicator: "healthy"
          }
        ]
      },
      {
        id: "usage",
        label: "Usage",
        icon: UsageIcon,
        badge: "Live",
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "usage",
            label: "Usage",
            icon: UsageIcon,
            description: "Request and token usage analytics",
            statusIndicator: "healthy"
          }
        ]
      },
      {
        id: "quota-tracker",
        label: "Quota Tracker",
        icon: QuotaIcon,
        badge: "85% Avg",
        statusIndicator: "warning",
        collapsible: false,
        items: [
          {
            route: "quota-tracker",
            label: "Quota Tracker",
            icon: QuotaIcon,
            description: "Provider quota, reset time, and exhaustion status",
            statusIndicator: "warning"
          }
        ]
      },
      {
        id: "mitm",
        label: "MITM",
        icon: MitmIcon,
        statusIndicator: "unknown",
        collapsible: false,
        items: [
          {
            route: "mitm",
            label: "MITM",
            icon: MitmIcon,
            description: "Request inspection and proxy debugging",
            statusIndicator: "unknown"
          }
        ]
      },
      {
        id: "cli-tools",
        label: "CLI Tools",
        icon: CliIcon,
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "cli-tools",
            label: "CLI Tools",
            icon: CliIcon,
            description: "Setup commands for Claude Code, Codex, Cursor, Cline, and other tools",
            statusIndicator: "healthy"
          }
        ]
      }
    ]
  },
  {
    id: "system",
    label: "SYSTEM",
    icon: SettingsIcon,
    sections: [
      {
        id: "console-log",
        label: "Console Log",
        icon: ConsoleIcon,
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "console-log",
            label: "Console Log",
            icon: ConsoleIcon,
            description: "Runtime logs, provider errors, and request traces",
            statusIndicator: "healthy"
          }
        ]
      },
      {
        id: "settings",
        label: "Settings",
        icon: SettingsIcon,
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "settings",
            label: "Settings",
            icon: SettingsIcon,
            description: "App settings, auth, theme, and security",
            statusIndicator: "healthy"
          }
        ]
      }
    ]
  }
];

// Legacy tab navigation for backward compatibility
export const tabNavigation: TabNavigation[] = [
  {
    id: "overview",
    label: "Overview",
    icon: DashboardIcon,
    route: "dashboard",
    sections: []
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    icon: ConfigIcon,
    sections: [
      {
        id: "providers",
        label: "Providers",
        icon: ProvidersIcon,
        badge: "3 Active",
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "providers",
            label: "All Providers",
            icon: ProvidersIcon,
            description: "AI provider inventory & settings",
            statusIndicator: "healthy"
          }
        ]
      },
      {
        id: "clients",
        label: "Client Routes",
        icon: ClientsIcon,
        badge: "12 Routes",
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "clients",
            label: "Route Management",
            icon: ClientsIcon,
            description: "Client routing & API keys",
            statusIndicator: "healthy"
          }
        ]
      },
      {
        id: "rtk",
        label: "RTK Policies",
        icon: RtkIcon,
        badge: "Advanced",
        statusIndicator: "warning",
        collapsible: false,
        items: [
          {
            route: "rtk",
            label: "Policy Configuration",
            icon: RtkIcon,
            description: "Request/response reduction policies",
            badge: "Advanced"
          }
        ]
      }
    ]
  },
  {
    id: "accounts",
    label: "Accounts",
    icon: AccountsIcon,
    sections: [
      {
        id: "oauth-accounts",
        label: "OAuth Providers",
        icon: AccountsIcon,
        badge: "5 Connected",
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "oauth",
            label: "Provider Accounts",
            icon: AccountsIcon,
            description: "OAuth & Kiro account management",
            statusIndicator: "healthy"
          }
        ]
      },
      {
        id: "authentication",
        label: "Authentication",
        icon: AuthIcon,
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "auth-management",
            label: "Auth Management",
            icon: AuthIcon,
            description: "Account authentication settings",
            statusIndicator: "healthy"
          }
        ]
      }
    ]
  },
  {
    id: "monitoring",
    label: "Monitoring",
    icon: UsageIcon,
    sections: [
      {
        id: "usage-analytics",
        label: "Usage Analytics",
        icon: UsageIcon,
        badge: "Live",
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "usage",
            label: "API Usage",
            icon: UsageIcon,
            description: "API usage statistics & trends",
            statusIndicator: "healthy"
          }
        ]
      },
      {
        id: "cache-telemetry",
        label: "Cache Telemetry",
        icon: CacheIcon,
        badge: "85% Hit Rate",
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "cache",
            label: "Cache Performance",
            icon: CacheIcon,
            description: "Prompt cache performance metrics",
            statusIndicator: "healthy"
          }
        ]
      }
    ]
  },
  {
    id: "tools",
    label: "Tools",
    icon: ConfigIcon,
    sections: [
      {
        id: "configuration",
        label: "Configuration",
        icon: ConfigIcon,
        statusIndicator: "healthy",
        collapsible: false,
        items: [
          {
            route: "config-helper",
            label: "Config Helper",
            icon: ConfigIcon,
            description: "Local configuration patches",
            statusIndicator: "healthy"
          }
        ]
      }
    ]
  }
];

// Router-focused functional navigation structure
export const routerFunctionalNavGroups: FunctionalNavGroup[] = [
  {
    id: "main",
    label: "MAIN",
    icon: EndpointIcon,
    collapsible: false,
    items: [
      {
        route: "endpoint",
        label: "Endpoint",
        icon: EndpointIcon,
        description: "Local OpenAI-compatible endpoint and client setup"
      },
      {
        route: "providers",
        label: "Providers",
        icon: ProvidersIcon,
        description: "Manage AI provider connections"
      },
      {
        route: "combos",
        label: "Combos",
        icon: CombosIcon,
        description: "Routing combinations and fallback chains"
      },
      {
        route: "usage",
        label: "Usage",
        icon: UsageIcon,
        description: "Request and token usage analytics"
      },
      {
        route: "quota-tracker",
        label: "Quota Tracker",
        icon: QuotaIcon,
        description: "Provider quota, reset time, and exhaustion status"
      },
      {
        route: "mitm",
        label: "MITM",
        icon: MitmIcon,
        description: "Request inspection and proxy debugging"
      },
      {
        route: "cli-tools",
        label: "CLI Tools",
        icon: CliIcon,
        description: "Setup commands for Claude Code, Codex, Cursor, Cline, and other tools"
      }
    ]
  },
  {
    id: "system",
    label: "SYSTEM",
    icon: SettingsIcon,
    collapsible: true,
    items: [
      {
        route: "console-log",
        label: "Console Log",
        icon: ConsoleIcon,
        description: "Runtime logs, provider errors, and request traces"
      },
      {
        route: "settings",
        label: "Settings",
        icon: SettingsIcon,
        description: "App settings, auth, theme, and security"
      }
    ]
  }
];

// Legacy functional navigation structure (for backward compatibility)
export const functionalNavGroups: FunctionalNavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: DashboardIcon,
    collapsible: false,
    items: [
      {
        route: "dashboard",
        label: "Dashboard",
        icon: DashboardIcon,
        description: "System status & health overview"
      }
    ]
  },
  {
    id: "infrastructure",
    label: "Infrastructure",
    icon: ConfigIcon,
    collapsible: true,
    items: [
      {
        route: "providers",
        label: "Providers",
        icon: ProvidersIcon,
        description: "AI provider inventory & settings"
      },
      {
        route: "clients",
        label: "Client Routes",
        icon: ClientsIcon,
        description: "Client routing & API keys"
      },
      {
        route: "rtk",
        label: "RTK Policies",
        icon: RtkIcon,
        description: "Request/response reduction policies",
        badge: "Advanced"
      }
    ]
  },
  {
    id: "accounts",
    label: "Account Management",
    icon: AccountsIcon,
    collapsible: true,
    items: [
      {
        route: "oauth",
        label: "Provider Accounts",
        icon: AccountsIcon,
        description: "OAuth & Kiro account management"
      },
      {
        route: "auth-management",
        label: "Authentication",
        icon: AuthIcon,
        description: "Account authentication settings"
      }
    ]
  },
  {
    id: "monitoring",
    label: "Monitoring & Analytics",
    icon: UsageIcon,
    collapsible: true,
    items: [
      {
        route: "usage",
        label: "Usage Analytics",
        icon: UsageIcon,
        description: "API usage statistics & trends"
      },
      {
        route: "cache",
        label: "Cache Telemetry",
        icon: CacheIcon,
        description: "Prompt cache performance metrics"
      }
    ]
  },
  {
    id: "tools",
    label: "Tools",
    icon: ConfigIcon,
    collapsible: true,
    items: [
      {
        route: "config-helper",
        label: "Config Helper",
        icon: ConfigIcon,
        description: "Local configuration patches"
      }
    ]
  }
];

// Route aliases for backward compatibility
export const routeAliases: Record<string, NavRoute> = {
  // Router-focused aliases
  "endpoint": "endpoint",
  "combos": "combos",
  "quota-tracker": "quota-tracker",
  "mitm": "mitm",
  "cli-tools": "cli-tools",
  "media-providers": "media-providers",
  "proxy-pools": "proxy-pools",
  "skills": "skills",
  "console-log": "console-log",
  "settings": "settings",

  // Legacy aliases
  "dashboard": "dashboard",
  "providers": "providers",
  "clients": "clients",
  "oauth": "oauth",
  "auth-management": "auth-management",
  "config-helper": "config-helper",
  "usage": "usage",
  "cache": "cache",
  "rtk": "rtk",

  // Additional aliases for convenience
  "routing": "combos",
  "fallback": "combos",
  "quota": "quota-tracker",
  "logs": "console-log",
  "debug": "mitm",
  "setup": "cli-tools",
  "config": "settings"
};

// Flat navigation for backward compatibility
export const flatNavItems = functionalNavGroups.flatMap(group => group.items);
export const routerFlatNavItems = routerFunctionalNavGroups.flatMap(group => group.items);

// Helper functions for router navigation
export function getRouterTabById(tabId: string): TabNavigation | undefined {
  return routerNavigation.find(tab => tab.id === tabId);
}

export function getRouterSectionById(tabId: string, sectionId: string): NavSection | undefined {
  const tab = getRouterTabById(tabId);
  return tab?.sections.find(section => section.id === sectionId);
}

export function getRouterNavItemByRoute(route: NavRoute): NavItem | undefined {
  for (const tab of routerNavigation) {
    if (tab.route === route) {
      // Single-section tab
      return {
        route: tab.route,
        label: tab.label,
        icon: tab.icon,
        description: `${tab.label} section`
      };
    }

    for (const section of tab.sections) {
      const item = section.items.find(item => item.route === route);
      if (item) return item;
    }
  }
  return undefined;
}

export function getRouterActiveTab(route: NavRoute): string | undefined {
  for (const tab of routerNavigation) {
    if (tab.route === route) return tab.id;

    for (const section of tab.sections) {
      if (section.items.some(item => item.route === route)) {
        return tab.id;
      }
    }
  }
  return undefined;
}

export function getRouterActiveSection(route: NavRoute): string | undefined {
  for (const tab of routerNavigation) {
    for (const section of tab.sections) {
      if (section.items.some(item => item.route === route)) {
        return section.id;
      }
    }
  }
  return undefined;
}

// Helper functions for tab navigation (legacy)
export function getTabById(tabId: string): TabNavigation | undefined {
  return tabNavigation.find(tab => tab.id === tabId);
}

export function getSectionById(tabId: string, sectionId: string): NavSection | undefined {
  const tab = getTabById(tabId);
  return tab?.sections.find(section => section.id === sectionId);
}

export function getNavItemByRoute(route: NavRoute): NavItem | undefined {
  for (const tab of tabNavigation) {
    if (tab.route === route) {
      // Single-section tab (like Overview)
      return {
        route: tab.route,
        label: tab.label,
        icon: tab.icon,
        description: `${tab.label} section`
      };
    }

    for (const section of tab.sections) {
      const item = section.items.find(item => item.route === route);
      if (item) return item;
    }
  }
  return undefined;
}

export function getActiveTab(route: NavRoute): string | undefined {
  for (const tab of tabNavigation) {
    if (tab.route === route) return tab.id;

    for (const section of tab.sections) {
      if (section.items.some(item => item.route === route)) {
        return tab.id;
      }
    }
  }
  return undefined;
}

export function getActiveSection(route: NavRoute): string | undefined {
  for (const tab of tabNavigation) {
    for (const section of tab.sections) {
      if (section.items.some(item => item.route === route)) {
        return section.id;
      }
    }
  }
  return undefined;
}

// Utility functions
export function resolveRouteAlias(routeOrAlias: string): NavRoute | undefined {
  return routeAliases[routeOrAlias] as NavRoute;
}

export function isRouterFocusedRoute(route: NavRoute): boolean {
  const routerRoutes: NavRoute[] = [
    "endpoint", "combos", "quota-tracker", "mitm", "cli-tools",
    "media-providers", "proxy-pools", "skills", "console-log", "settings"
  ];
  return routerRoutes.includes(route);
}

export function getNavigationMode(): "router" | "legacy" {
  // This can be controlled by a feature flag or user preference
  // For now, default to router mode
  return "router";
}

export function getCurrentNavigation(): TabNavigation[] {
  return getNavigationMode() === "router" ? routerNavigation : tabNavigation;
}

export function getCurrentFunctionalNavGroups(): FunctionalNavGroup[] {
  return getNavigationMode() === "router" ? routerFunctionalNavGroups : functionalNavGroups;
}