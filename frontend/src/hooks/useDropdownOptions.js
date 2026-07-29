import { useEffect, useState, useCallback } from 'react';
import api from '@/api/axiosInstance';

const EMPTY = { service_type: [], service_status: [], location: [], group_size: [] };

// Service Type/Status/Location/Group Size options are admin-configurable
// (Company Information > Dropdown Options) rather than hardcoded. Each row
// is { id, category, code, label, sort_order, is_active }. Consumers that
// populate a dropdown for a *new* log should filter to is_active; consumers
// resolving a code to a label for display (e.g. an existing log) should use
// the full list so a since-deactivated code still shows its label.
export function useDropdownOptions() {
  const [options, setOptions] = useState(EMPTY);
  const [isLoading, setIsLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const response = await api.get('/api/dropdown-options');
      setOptions(response.data.options);
    } catch (error) {
      console.error('Failed to fetch dropdown options', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { options, isLoading, refetch };
}

export const activeOnly = (list) => (list || []).filter((o) => o.is_active);

export const buildCodeLabelMap = (list) => {
  const map = {};
  for (const o of list || []) map[o.code] = o.label;
  return map;
};
