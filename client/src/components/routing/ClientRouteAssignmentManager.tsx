// Client Route Assignment Management Component
import React, { useState } from 'react';
import {
  useClientRouteAssignments,
  useClientRouteAssignmentOperations
} from '../features/routing/clientRouteHooks';
import { useRoutingCombos } from '../features/routing/routingHooks';

export function ClientRouteAssignmentManager() {
  const { assignments, loading: assignmentsLoading, error: assignmentsError, refresh } = useClientRouteAssignments();
  const { combos, loading: combosLoading } = useRoutingCombos();
  const { assignCombo, unassignCombo, isAssigning, isUnassigning } = useClientRouteAssignmentOperations();

  const [selectedClientRoute, setSelectedClientRoute] = useState('');
  const [selectedComboId, setSelectedComboId] = useState('');
  const [showAssignForm, setShowAssignForm] = useState(false);

  const handleAssign = async () => {
    if (!selectedClientRoute || !selectedComboId) return;

    const result = await assignCombo(selectedClientRoute, selectedComboId);
    if (result.success) {
      setShowAssignForm(false);
      setSelectedClientRoute('');
      setSelectedComboId('');
      refresh();
    } else {
      alert(`Failed to assign combo: ${result.error}`);
    }
  };

  const handleUnassign = async (clientRoute: string) => {
    if (!confirm(`Remove routing combo assignment from client route "${clientRoute}"?`)) return;

    const result = await unassignCombo(clientRoute);
    if (result.success) {
      refresh();
    } else {
      alert(`Failed to unassign combo: ${result.error}`);
    }
  };

  if (assignmentsLoading || combosLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
        <span className="ml-3 text-gray-600">Loading client route assignments...</span>
      </div>
    );
  }

  if (assignmentsError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error loading assignments</h3>
            <p className="mt-1 text-sm text-red-700">{assignmentsError}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Client Route Assignments</h2>
          <p className="text-sm text-gray-600 mt-1">
            Assign routing combos to client routes for enhanced provider selection
          </p>
        </div>
        <button
          onClick={() => setShowAssignForm(true)}
          className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          New Assignment
        </button>
      </div>

      {/* Assignment Form */}
      {showAssignForm && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Assign Routing Combo</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Client Route
              </label>
              <input
                type="text"
                value={selectedClientRoute}
                onChange={(e) => setSelectedClientRoute(e.target.value)}
                placeholder="Enter client route name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Routing Combo
              </label>
              <select
                value={selectedComboId}
                onChange={(e) => setSelectedComboId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              >
                <option value="">Select a routing combo</option>
                {combos.filter(combo => combo.isActive).map(combo => (
                  <option key={combo.id} value={combo.id}>
                    {combo.name} {combo.isDefault ? '(Default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              onClick={() => {
                setShowAssignForm(false);
                setSelectedClientRoute('');
                setSelectedComboId('');
              }}
              className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAssign}
              disabled={!selectedClientRoute || !selectedComboId || isAssigning(selectedClientRoute)}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {isAssigning(selectedClientRoute) ? 'Assigning...' : 'Assign'}
            </button>
          </div>
        </div>
      )}

      {/* Assignments List */}
      <div className="bg-white border border-gray-200 rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Current Assignments</h3>
        </div>

        {assignments.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <div className="text-gray-400 mb-2">
              <svg className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-gray-900 mb-1">No assignments</h3>
            <p className="text-sm text-gray-500">
              Client routes will use the default routing combo or simple provider selection
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {assignments.map((assignment) => (
              <div key={assignment.clientRoute} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {assignment.clientRoute}
                  </div>
                  <div className="text-sm text-gray-500">
                    Assigned to: <span className="font-medium">{assignment.comboName}</span>
                  </div>
                </div>

                <button
                  onClick={() => handleUnassign(assignment.clientRoute)}
                  disabled={isUnassigning(assignment.clientRoute)}
                  className="text-red-600 hover:text-red-800 disabled:text-gray-400 text-sm font-medium transition-colors"
                >
                  {isUnassigning(assignment.clientRoute) ? 'Removing...' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">How it works</h3>
            <div className="mt-1 text-sm text-blue-700">
              <ul className="list-disc list-inside space-y-1">
                <li>Client routes with assignments use their assigned routing combo for provider selection</li>
                <li>Unassigned routes fall back to the default routing combo (if set)</li>
                <li>If no default combo exists, simple provider selection is used</li>
                <li>Explicit provider headers (x-provider-id, x-provider-name) always bypass routing combos</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}