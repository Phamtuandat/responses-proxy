// API client for client route assignments with routing combos
import type { RoutingCombo } from "./routingTypes";

export type ClientRouteAssignment = {
  clientRoute: string;
  comboId: string;
  comboName: string;
};

export type ClientRouteAssignmentDetail = {
  clientRoute: string;
  comboId: string | null;
  combo: RoutingCombo | null;
};

// Get all client route assignments
export async function fetchClientRouteAssignments(): Promise<ClientRouteAssignment[]> {
  const response = await fetch('/api/routing/client-routes');

  if (!response.ok) {
    throw new Error(`Failed to fetch client route assignments: ${response.statusText}`);
  }

  const data = await response.json();
  return data.assignments || [];
}

// Get assignment for a specific client route
export async function fetchClientRouteAssignment(clientRoute: string): Promise<ClientRouteAssignmentDetail> {
  const response = await fetch(`/api/routing/client-routes/${encodeURIComponent(clientRoute)}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch client route assignment: ${response.statusText}`);
  }

  return response.json();
}

// Assign routing combo to client route
export async function assignClientRouteCombo(clientRoute: string, comboId: string): Promise<void> {
  const response = await fetch(`/api/routing/client-routes/${encodeURIComponent(clientRoute)}/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comboId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.message || `Failed to assign routing combo: ${response.statusText}`);
  }
}

// Remove routing combo assignment from client route
export async function unassignClientRouteCombo(clientRoute: string): Promise<void> {
  const response = await fetch(`/api/routing/client-routes/${encodeURIComponent(clientRoute)}/assign`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.message || `Failed to unassign routing combo: ${response.statusText}`);
  }
}

// Get client routes assigned to a specific combo
export async function fetchComboClientRoutes(comboId: string): Promise<string[]> {
  const response = await fetch(`/api/routing/combos/${encodeURIComponent(comboId)}/client-routes`);

  if (!response.ok) {
    throw new Error(`Failed to fetch combo client routes: ${response.statusText}`);
  }

  const data = await response.json();
  return data.clientRoutes || [];
}