import { useState, useMemo, useCallback } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

export type TableColumn<T> = {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  width?: string;
  render?: (value: any, row: T, index: number) => React.ReactNode;
  className?: string;
};

export type TableState<T> = {
  data: T[];
  sortColumn: string | null;
  sortDirection: SortDirection;
  searchQuery: string;
  selectedRows: Set<string | number>;
  currentPage: number;
  pageSize: number;
};

export function useTableState<T>(
  initialData: T[],
  getRowId: (row: T) => string | number,
  initialPageSize: number = 25
) {
  const [state, setState] = useState<TableState<T>>({
    data: initialData,
    sortColumn: null,
    sortDirection: null,
    searchQuery: '',
    selectedRows: new Set(),
    currentPage: 1,
    pageSize: initialPageSize,
  });

  const updateData = useCallback((newData: T[]) => {
    setState(prev => ({ ...prev, data: newData, currentPage: 1 }));
  }, []);

  const setSort = useCallback((column: string) => {
    setState(prev => {
      if (prev.sortColumn === column) {
        const newDirection = prev.sortDirection === 'asc' ? 'desc' : prev.sortDirection === 'desc' ? null : 'asc';
        return {
          ...prev,
          sortColumn: newDirection ? column : null,
          sortDirection: newDirection,
          currentPage: 1,
        };
      } else {
        return {
          ...prev,
          sortColumn: column,
          sortDirection: 'asc',
          currentPage: 1,
        };
      }
    });
  }, []);

  const setSearch = useCallback((query: string) => {
    setState(prev => ({
      ...prev,
      searchQuery: query,
      currentPage: 1,
    }));
  }, []);

  const toggleRowSelection = useCallback((rowId: string | number) => {
    setState(prev => {
      const newSelected = new Set(prev.selectedRows);
      if (newSelected.has(rowId)) {
        newSelected.delete(rowId);
      } else {
        newSelected.add(rowId);
      }
      return { ...prev, selectedRows: newSelected };
    });
  }, []);

  const toggleAllRows = useCallback((visible: boolean = false) => {
    setState(prev => {
      const rowsToToggle = visible ? filteredAndSortedData : prev.data;
      const allIds = rowsToToggle.map(getRowId);
      const allSelected = allIds.every(id => prev.selectedRows.has(id));

      if (allSelected) {
        // Deselect all
        const newSelected = new Set(prev.selectedRows);
        allIds.forEach(id => newSelected.delete(id));
        return { ...prev, selectedRows: newSelected };
      } else {
        // Select all
        const newSelected = new Set(prev.selectedRows);
        allIds.forEach(id => newSelected.add(id));
        return { ...prev, selectedRows: newSelected };
      }
    });
  }, []);

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selectedRows: new Set() }));
  }, []);

  const setPage = useCallback((page: number) => {
    setState(prev => ({ ...prev, currentPage: page }));
  }, []);

  const setPageSize = useCallback((size: number) => {
    setState(prev => ({ ...prev, pageSize: size, currentPage: 1 }));
  }, []);

  // Computed values
  const filteredAndSortedData = useMemo(() => {
    let result = [...state.data];

    // Apply search filter
    if (state.searchQuery) {
      const query = state.searchQuery.toLowerCase();
      result = result.filter(row => {
        return Object.values(row as any).some(value =>
          String(value).toLowerCase().includes(query)
        );
      });
    }

    // Apply sorting
    if (state.sortColumn && state.sortDirection) {
      result.sort((a, b) => {
        const aValue = (a as any)[state.sortColumn!];
        const bValue = (b as any)[state.sortColumn!];

        let comparison = 0;
        if (aValue < bValue) comparison = -1;
        if (aValue > bValue) comparison = 1;

        return state.sortDirection === 'desc' ? -comparison : comparison;
      });
    }

    return result;
  }, [state.data, state.searchQuery, state.sortColumn, state.sortDirection]);

  const paginatedData = useMemo(() => {
    const startIndex = (state.currentPage - 1) * state.pageSize;
    const endIndex = startIndex + state.pageSize;
    return filteredAndSortedData.slice(startIndex, endIndex);
  }, [filteredAndSortedData, state.currentPage, state.pageSize]);

  const totalPages = Math.ceil(filteredAndSortedData.length / state.pageSize);
  const hasSelection = state.selectedRows.size > 0;
  const isAllSelected = filteredAndSortedData.length > 0 &&
    filteredAndSortedData.every(row => state.selectedRows.has(getRowId(row)));
  const isPartiallySelected = hasSelection && !isAllSelected;

  return {
    // State
    ...state,

    // Computed data
    filteredAndSortedData,
    paginatedData,
    totalPages,
    totalRows: filteredAndSortedData.length,
    hasSelection,
    isAllSelected,
    isPartiallySelected,

    // Actions
    updateData,
    setSort,
    setSearch,
    toggleRowSelection,
    toggleAllRows,
    clearSelection,
    setPage,
    setPageSize,
  };
}