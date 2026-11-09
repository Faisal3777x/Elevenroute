import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './api';
import { useAuth } from './auth';

/**
 * Cached GET of `path` (TanStack Query, persisted in this browser). Cached data shows immediately and is
 * refreshed in the background; previous data stays visible while a new path loads, so values animate
 * from old to new instead of flashing. Same shape as before: { data, error, loading, reload, setData }.
 */
export function useApi<T>(path: string | null, pollMs?: number) {
  const { user } = useAuth();
  const qc = useQueryClient();
  // The user id leads every key, so one user's cached data can never be served to another.
  const key = [user?.id ?? 'local', path] as const;
  const q = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get<T>(path!, signal),
    enabled: path !== null,
    refetchInterval: pollMs,
    placeholderData: keepPreviousData,
  });
  return {
    data: q.data,
    error: q.error ? (q.error as Error).message : null,
    // A getter, not a value: TanStack Query re-renders a component only for the fields it reads, so components that
    // never show "loading" are not re-rendered by every background refetch (a 15 s poll used to re-render whole pages
    // and replay every chart animation, which froze phones for seconds).
    get loading() {
      return q.isFetching;
    },
    reload: async () => {
      await q.refetch();
    },
    /** Optimistic or server-confirmed update of the cached value. */
    setData: (data: T | undefined) => qc.setQueryData(key, data),
  };
}
