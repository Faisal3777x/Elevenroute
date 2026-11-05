import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { api } from './api';

/** Fetches `path` whenever the screen gains focus (or `path` changes), and optionally polls. */
export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api.get<T>(path));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useFocusEffect(
    useCallback(() => {
      reload();
      if (!pollMs) return;
      const id = setInterval(reload, pollMs);
      return () => clearInterval(id);
    }, [reload, pollMs]),
  );

  return { data, error, loading, reload, setData };
}
