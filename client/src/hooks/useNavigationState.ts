import { useEffect, useState } from "react";

const NAVIGATION_STATE_KEY = "responses-proxy-nav-state";

type NavigationState = {
  collapsedGroups: string[];
};

export function useNavigationState() {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(NAVIGATION_STATE_KEY);
      if (stored) {
        const state: NavigationState = JSON.parse(stored);
        return new Set(state.collapsedGroups);
      }
    } catch (error) {
      console.warn("Failed to load navigation state:", error);
    }
    return new Set();
  });

  // Persist state changes to localStorage
  useEffect(() => {
    try {
      const state: NavigationState = {
        collapsedGroups: Array.from(collapsedGroups),
      };
      localStorage.setItem(NAVIGATION_STATE_KEY, JSON.stringify(state));
    } catch (error) {
      console.warn("Failed to save navigation state:", error);
    }
  }, [collapsedGroups]);

  const toggleGroup = (groupId: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupId)) {
      newCollapsed.delete(groupId);
    } else {
      newCollapsed.add(groupId);
    }
    setCollapsedGroups(newCollapsed);
  };

  const isGroupCollapsed = (groupId: string): boolean => {
    return collapsedGroups.has(groupId);
  };

  const collapseAll = () => {
    // Get all collapsible group IDs from functional navigation
    import("../navigation/FunctionalNavigation").then(({ functionalNavGroups }) => {
      const collapsibleGroups = functionalNavGroups
        .filter(group => group.collapsible !== false)
        .map(group => group.id);
      setCollapsedGroups(new Set(collapsibleGroups));
    });
  };

  const expandAll = () => {
    setCollapsedGroups(new Set());
  };

  return {
    collapsedGroups,
    toggleGroup,
    isGroupCollapsed,
    collapseAll,
    expandAll,
  };
}