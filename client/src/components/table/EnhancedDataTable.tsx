import React from 'react';
import { useTableState, type TableColumn } from '../../hooks/useTableState';

export type EnhancedDataTableProps<T> = {
  data: T[];
  columns: TableColumn<T>[];
  getRowId: (row: T) => string | number;
  title?: string;
  searchPlaceholder?: string;
  pageSize?: number;
  showSearch?: boolean;
  showPagination?: boolean;
  showSelection?: boolean;
  onRowClick?: (row: T) => void;
  onSelectionChange?: (selectedRows: T[]) => void;
  bulkActions?: Array<{
    label: string;
    icon?: React.ComponentType;
    onClick: (selectedRows: T[]) => void;
    variant?: 'default' | 'danger';
  }>;
  className?: string;
};

export function EnhancedDataTable<T>({
  data,
  columns,
  getRowId,
  title,
  searchPlaceholder = 'Search...',
  pageSize = 25,
  showSearch = true,
  showPagination = true,
  showSelection = false,
  onRowClick,
  onSelectionChange,
  bulkActions = [],
  className = '',
}: EnhancedDataTableProps<T>) {
  const tableState = useTableState(data, getRowId, pageSize);

  const {
    paginatedData,
    searchQuery,
    sortColumn,
    sortDirection,
    selectedRows,
    hasSelection,
    isAllSelected,
    isPartiallySelected,
    totalRows,
    totalPages,
    currentPage,
    setSearch,
    setSort,
    toggleRowSelection,
    toggleAllRows,
    clearSelection,
    setPage,
  } = tableState;

  // Notify parent of selection changes
  React.useEffect(() => {
    if (onSelectionChange) {
      const selectedRowData = data.filter(row => selectedRows.has(getRowId(row)));
      onSelectionChange(selectedRowData);
    }
  }, [selectedRows, data, getRowId, onSelectionChange]);

  const handleRowClick = (row: T, event: React.MouseEvent) => {
    // Don't trigger row click if clicking on checkbox or action buttons
    if ((event.target as HTMLElement).closest('input, button')) {
      return;
    }
    onRowClick?.(row);
  };

  const renderPagination = () => {
    if (!showPagination || totalPages <= 1) return null;

    const pages = [];
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(
        <button
          key={i}
          className={`pagination-button ${i === currentPage ? 'active' : ''}`}
          onClick={() => setPage(i)}
        >
          {i}
        </button>
      );
    }

    return (
      <div className="table-pagination">
        <div className="pagination-info">
          Showing {((currentPage - 1) * pageSize) + 1} to {Math.min(currentPage * pageSize, totalRows)} of {totalRows} results
        </div>
        <div className="pagination-controls">
          <button
            className="pagination-button"
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            Previous
          </button>
          {startPage > 1 && (
            <>
              <button className="pagination-button" onClick={() => setPage(1)}>1</button>
              {startPage > 2 && <span className="pagination-ellipsis">...</span>}
            </>
          )}
          {pages}
          {endPage < totalPages && (
            <>
              {endPage < totalPages - 1 && <span className="pagination-ellipsis">...</span>}
              <button className="pagination-button" onClick={() => setPage(totalPages)}>{totalPages}</button>
            </>
          )}
          <button
            className="pagination-button"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`enhanced-table-container ${className}`}>
      {/* Table Toolbar */}
      <div className="table-toolbar">
        <div className="table-toolbar-left">
          {title && <h3 className="table-title">{title}</h3>}
          {showSearch && (
            <div className="table-search">
              <input
                type="text"
                className="table-search-input"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="table-toolbar-right">
          {hasSelection && bulkActions.length > 0 && (
            <div className="bulk-actions">
              <span className="selection-count">{selectedRows.size} selected</span>
              {bulkActions.map((action, index) => (
                <button
                  key={index}
                  className={`bulk-action-button ${action.variant === 'danger' ? 'danger' : ''}`}
                  onClick={() => {
                    const selectedRowData = data.filter(row => selectedRows.has(getRowId(row)));
                    action.onClick(selectedRowData);
                  }}
                >
                  {action.icon && <action.icon />}
                  {action.label}
                </button>
              ))}
              <button className="bulk-action-button" onClick={clearSelection}>
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="table-scroll-container">
        <table className="enhanced-table">
          <thead>
            <tr>
              {showSelection && (
                <th className="selection-column">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = isPartiallySelected;
                    }}
                    onChange={() => toggleAllRows(true)}
                    aria-label="Select all rows"
                  />
                </th>
              )}
              {columns.map((column) => {
                const isSorted = sortColumn === column.key;
                const ariaSort = column.sortable
                  ? isSorted
                    ? sortDirection === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                  : undefined;

                return (
                  <th
                    key={String(column.key)}
                    className={`
                      ${column.sortable ? 'sortable' : ''}
                      ${isSorted ? `sorted-${sortDirection}` : ''}
                      ${column.className || ''}
                    `}
                    style={{ width: column.width }}
                    aria-sort={ariaSort}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className="table-sort-button"
                        onClick={() => setSort(String(column.key))}
                        aria-label={`Sort by ${column.label}`}
                      >
                        {column.label}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, index) => {
              const rowId = getRowId(row);
              const isSelected = selectedRows.has(rowId);

              return (
                <tr
                  key={String(rowId)}
                  className={`${isSelected ? 'selected' : ''} ${onRowClick ? 'clickable' : ''}`}
                  onClick={(e) => handleRowClick(row, e)}
                >
                  {showSelection && (
                    <td className="selection-column">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRowSelection(rowId)}
                        aria-label="Select row"
                      />
                    </td>
                  )}
                  {columns.map((column) => {
                    const value = (row as any)[column.key];
                    const cellContent = column.render
                      ? column.render(value, row, index)
                      : String(value || '');

                    return (
                      <td
                        key={String(column.key)}
                        className={column.className}
                      >
                        {cellContent}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {paginatedData.length === 0 && (
          <div className="table-empty-state">
            <p>No data found</p>
            {searchQuery && (
              <p className="table-empty-subtitle">
                Try adjusting your search criteria
              </p>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {renderPagination()}
    </div>
  );
}