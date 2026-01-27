import { useState, useMemo } from 'react';

/**
 * Custom hook for table sorting
 * @param {Array} data - The data array to sort
 * @param {Object} config - Configuration object
 * @param {string} config.defaultSortKey - Default column to sort by
 * @param {string} config.defaultSortDirection - 'asc' or 'desc'
 * @returns {Object} - { sortedData, sortConfig, handleSort }
 */
export function useTableSort(data, config = {}) {
  const { defaultSortKey = null, defaultSortDirection = 'asc' } = config;
  
  const [sortConfig, setSortConfig] = useState({
    key: defaultSortKey,
    direction: defaultSortDirection
  });

  const sortedData = useMemo(() => {
    if (!data || data.length === 0) return data;
    if (!sortConfig.key) return data;

    const sorted = [...data].sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];

      // Handle null/undefined values
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;

      // Handle nested properties (e.g., 'ticket.ticket_id')
      if (sortConfig.key.includes('.')) {
        const keys = sortConfig.key.split('.');
        aValue = keys.reduce((obj, key) => obj?.[key], a);
        bValue = keys.reduce((obj, key) => obj?.[key], b);
      }

      // Handle string comparison
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        aValue = aValue.toLowerCase().trim();
        bValue = bValue.toLowerCase().trim();
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      }

      // Handle number comparison
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
      }

      // Handle date comparison
      if (aValue instanceof Date || (typeof aValue === 'string' && !isNaN(Date.parse(aValue)))) {
        const aDate = new Date(aValue);
        const bDate = new Date(bValue);
        return sortConfig.direction === 'asc' ? aDate - bDate : bDate - aDate;
      }

      // Fallback to string comparison
      aValue = String(aValue).toLowerCase();
      bValue = String(bValue).toLowerCase();
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [data, sortConfig]);

  const handleSort = (key) => {
    setSortConfig(prevConfig => {
      // If clicking the same column, toggle direction
      if (prevConfig.key === key) {
        return {
          key,
          direction: prevConfig.direction === 'asc' ? 'desc' : 'asc'
        };
      }
      // If clicking a different column, sort ascending by default
      return {
        key,
        direction: 'asc'
      };
    });
  };

  return {
    sortedData,
    sortConfig,
    handleSort
  };
}

/**
 * Component for sortable table header
 */
export function SortableHeader({ columnKey, onSort, children, sortConfig, className = '' }) {
  const isActive = sortConfig.key === columnKey;
  const direction = isActive ? sortConfig.direction : null;

  return (
    <th 
      className={`sortable-header ${className} ${isActive ? 'active' : ''}`}
      onClick={() => onSort(columnKey)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>{children}</span>
        <span className="sort-indicator">
          {direction === 'asc' && '↑'}
          {direction === 'desc' && '↓'}
          {!isActive && '⇅'}
        </span>
      </div>
    </th>
  );
}
