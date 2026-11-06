import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from './api';

/**
 * Fetches `path` on mount and when it changes. Keeps the previous data while
 * reloading so values animate from old to new instead of flashing.
 */
export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const controller = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!path) return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setLoading(true);
    try {
      const result = await api.get<T>(path, c.signal);
      if (!c.signal.aborted) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (!c.signal.aborted) setError((err as Error).message);
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    reload();
    if (!pollMs) return () => controller.current?.abort();
    const id = setInterval(reload, pollMs);
    return () => {
      clearInterval(id);
      controller.current?.abort();
    };
  }, [reload, pollMs]);

  return { data, error, loading, reload, setData };
}
