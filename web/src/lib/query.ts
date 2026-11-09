import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';

/**
 * Local cache: every API response is kept in memory and saved to this browser (localStorage), so pages
 * open instantly with the last data and refresh in the background (stale-while-revalidate).
 * Cache keys start with the user id, and the whole cache is wiped on sign-out.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000, // show cached data and refetch in the background after 15 s
      gcTime: 24 * 60 * 60 * 1000, // keep unused entries a day (must be >= persister maxAge)
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return undefined; // private mode / blocked storage: the cache still works in memory
  }
})();

export const persister = createSyncStoragePersister({ storage, key: 'elevenroute-cache', throttleTime: 1000 });

/** Bump to drop caches written by older builds whose data shapes may differ. */
export const CACHE_BUSTER = 'v1';
export const CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

export function clearCache(): void {
  queryClient.clear();
  try {
    storage?.removeItem('elevenroute-cache');
  } catch {
    /* ignore */
  }
}
