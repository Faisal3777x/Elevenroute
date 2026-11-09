import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';

import type { AppConfig, Mode } from '../../../shared/types';
import { api } from './api';
import { useApi } from './useApi';

interface ModeState {
  config: AppConfig | undefined;
  error: string | null;
  setMode: (mode: Mode) => Promise<void>;
}

const Ctx = createContext<ModeState>({ config: undefined, error: null, setMode: async () => {} });

/** Demo / live mode, shared by every page so the two are never confused. */
export function ModeProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useApi<AppConfig>('/config', 15_000);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const setMode = useCallback(async (mode: Mode) => {
    await api.post('/mode', { mode });
    await reloadRef.current();
  }, []);
  // A new value only when the config or error actually changes, so the 15 s poll doesn't re-render every page.
  const value = useMemo(() => ({ config: data, error, setMode }), [data, error, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useMode = () => useContext(Ctx);
