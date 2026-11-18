/**
 * useParking — Custom React hook for live parking data
 *
 * Fetches all slots from GET /api/slots on mount and refreshes every
 * REFRESH_INTERVAL_MS milliseconds.  Falls back to INITIAL_MOCK_SLOTS
 * when the backend is unreachable so the UI is always functional.
 *
 * Returns:
 *   slots           — normalized slot array (live or mock)
 *   isLoading       — true during the first fetch only
 *   isRefreshing    — true during background refresh polls
 *   error           — string | null — last fetch error message
 *   isBackendOnline — boolean derived from most recent fetch result
 *   lastUpdated     — Date | null of the last successful fetch
 *   dataSource      — 'backend' | 'mock'
 *   refresh         — () => void — manually trigger an immediate fetch
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchSlots, checkBackendHealth } from '../services/slotService.js';
import { INITIAL_MOCK_SLOTS } from '../data/mockSlots.js';

const REFRESH_INTERVAL_MS = 20_000; // 20 s automatic refresh

export default function useParking() {
  const [slots, setSlots] = useState([]);
  const [isLoading, setIsLoading] = useState(true);     // first-load spinner
  const [isRefreshing, setIsRefreshing] = useState(false); // background poll indicator
  const [error, setError] = useState(null);
  const [isBackendOnline, setIsBackendOnline] = useState(null); // null = unknown
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dataSource, setDataSource] = useState(null);   // 'backend' | 'mock'

  const isFirstFetch = useRef(true);
  const intervalRef = useRef(null);

  const loadSlots = useCallback(async (silent = false) => {
    if (!silent) {
      if (isFirstFetch.current) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
    }
    setError(null);

    try {
      const fetched = await fetchSlots();      // GET /api/slots (all slots, no filter)

      if (fetched && fetched.length > 0) {
        setSlots(fetched);
        setDataSource('backend');
        setIsBackendOnline(true);
        setLastUpdated(new Date());
      } else {
        // Backend responded but returned an empty array — keep existing data
        // and mark backend as online but warn.
        setIsBackendOnline(true);
        setLastUpdated(new Date());
        if (isFirstFetch.current) {
          // On first load with 0 slots from backend, fall back to mock
          setSlots(INITIAL_MOCK_SLOTS);
          setDataSource('mock');
          setError('Backend returned no slot data. Displaying demo data.');
        }
      }
    } catch (err) {
      setIsBackendOnline(false);
      const msg = err.message || 'Failed to reach the parking backend.';
      setError(msg);
      if (isFirstFetch.current) {
        // First load failure — use mock data so the UI is functional
        setSlots(INITIAL_MOCK_SLOTS);
        setDataSource('mock');
      }
      // On subsequent failures, keep existing live data intact (stale data
      // is preferable to resetting to mock mid-session)
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      isFirstFetch.current = false;
    }
  }, []);

  // Initial fetch + polling setup
  useEffect(() => {
    loadSlots(false);

    intervalRef.current = setInterval(() => {
      loadSlots(true); // silent = no spinner on background polls
    }, REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(intervalRef.current);
    };
  }, [loadSlots]);

  // Manual refresh trigger
  const refresh = useCallback(() => {
    if (!isLoading && !isRefreshing) {
      loadSlots(false);
    }
  }, [isLoading, isRefreshing, loadSlots]);

  return {
    slots,
    isLoading,
    isRefreshing,
    error,
    isBackendOnline,
    lastUpdated,
    dataSource,
    refresh,
  };
}
