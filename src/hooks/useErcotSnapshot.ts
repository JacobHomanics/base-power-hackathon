import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchErcotSnapshot } from '@/ercot/client';
import type { ErcotSnapshot } from '@/ercot/types';

const REFRESH_MS = 60_000;

export function useErcotSnapshot() {
  const [snapshot, setSnapshot] = useState<ErcotSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const inflight = useRef(false);
  const hasSnapshot = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) {
      return;
    }

    inflight.current = true;
    if (hasSnapshot.current) {
      setRefreshing(true);
    }

    try {
      const next = await fetchErcotSnapshot();
      hasSnapshot.current = true;
      setSnapshot(next);
      setError(null);
    } catch {
      if (!hasSnapshot.current) {
        setError('The ERCOT dashboards did not respond. Try again in a moment.');
      }
    } finally {
      inflight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void load();
    }, 0);
    const interval = setInterval(() => {
      void load();
    }, REFRESH_MS);

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [load]);

  return {
    snapshot,
    error,
    loading,
    refreshing,
    refresh: load,
  };
}
