// React hooks for client route assignments with routing combos
import { useState, useEffect, useCallback } from "react";
import {
  fetchClientRouteAssignments,
  fetchClientRouteAssignment,
  assignClientRouteCombo,
  unassignClientRouteCombo,
  fetchComboClientRoutes,
  type ClientRouteAssignment,
  type ClientRouteAssignmentDetail
} from "./clientRouteApi";

// Hook for fetching all client route assignments
export function useClientRouteAssignments() {
  const [assignments, setAssignments] = useState<ClientRouteAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAssignments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchClientRouteAssignments();
      setAssignments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load client route assignments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const refresh = useCallback(async () => {
    await loadAssignments();
  }, [loadAssignments]);

  return {
    assignments,
    loading,
    error,
    refresh
  };
}

// Hook for fetching a specific client route assignment
export function useClientRouteAssignment(clientRoute: string | null) {
  const [assignment, setAssignment] = useState<ClientRouteAssignmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAssignment = useCallback(async (route: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchClientRouteAssignment(route);
      setAssignment(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load client route assignment');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (clientRoute) {
      loadAssignment(clientRoute);
    } else {
      setAssignment(null);
      setLoading(false);
      setError(null);
    }
  }, [clientRoute, loadAssignment]);

  const refresh = useCallback(async () => {
    if (clientRoute) {
      await loadAssignment(clientRoute);
    }
  }, [clientRoute, loadAssignment]);

  return {
    assignment,
    loading,
    error,
    refresh
  };
}

// Hook for managing client route assignments
export function useClientRouteAssignmentOperations() {
  const [assigning, setAssigning] = useState<Set<string>>(new Set());
  const [unassigning, setUnassigning] = useState<Set<string>>(new Set());

  const assignCombo = useCallback(async (clientRoute: string, comboId: string) => {
    if (assigning.has(clientRoute)) return;

    try {
      setAssigning(prev => new Set(prev).add(clientRoute));
      await assignClientRouteCombo(clientRoute, comboId);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to assign routing combo'
      };
    } finally {
      setAssigning(prev => {
        const newSet = new Set(prev);
        newSet.delete(clientRoute);
        return newSet;
      });
    }
  }, [assigning]);

  const unassignCombo = useCallback(async (clientRoute: string) => {
    if (unassigning.has(clientRoute)) return;

    try {
      setUnassigning(prev => new Set(prev).add(clientRoute));
      await unassignClientRouteCombo(clientRoute);
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to unassign routing combo'
      };
    } finally {
      setUnassigning(prev => {
        const newSet = new Set(prev);
        newSet.delete(clientRoute);
        return newSet;
      });
    }
  }, [unassigning]);

  const isAssigning = useCallback((clientRoute: string) => {
    return assigning.has(clientRoute);
  }, [assigning]);

  const isUnassigning = useCallback((clientRoute: string) => {
    return unassigning.has(clientRoute);
  }, [unassigning]);

  return {
    assignCombo,
    unassignCombo,
    isAssigning,
    isUnassigning
  };
}

// Hook for fetching client routes assigned to a combo
export function useComboClientRoutes(comboId: string | null) {
  const [clientRoutes, setClientRoutes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadClientRoutes = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchComboClientRoutes(id);
      setClientRoutes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load combo client routes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (comboId) {
      loadClientRoutes(comboId);
    } else {
      setClientRoutes([]);
      setLoading(false);
      setError(null);
    }
  }, [comboId, loadClientRoutes]);

  const refresh = useCallback(async () => {
    if (comboId) {
      await loadClientRoutes(comboId);
    }
  }, [comboId, loadClientRoutes]);

  return {
    clientRoutes,
    loading,
    error,
    refresh
  };
}