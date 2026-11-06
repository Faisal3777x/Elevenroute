import { createContext, useContext, type ReactNode } from 'react';

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
  const setMode = async (mode: Mode) => {
    await api.post('/mode', { mode });
    await reload();
  };
  return <Ctx.Provider value={{ config: data, error, setMode }}>{children}</Ctx.Provider>;
}

export const useMode = () => useContext(Ctx);
