import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hydrate, newGame, serialize, tick } from '../game/engine';
import type { GameState } from '../game/engine';

const KEY = 'night-bite-diner/save-v1';
const TICK_MS = 100;

/** Owns the game state: loads the save, ticks ten times a second, saves every few seconds and on backgrounding. */
export function useGame() {
  const ref = useRef<GameState | null>(null);
  const [, setFrame] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const persist = useCallback(() => {
    if (ref.current) AsyncStorage.setItem(KEY, serialize(ref.current)).catch(() => {});
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        ref.current = raw ? hydrate(JSON.parse(raw), Date.now()) : newGame(Date.now());
      })
      .catch(() => {
        ref.current = newGame(Date.now());
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const loop = setInterval(() => {
      tick(ref.current!, Date.now());
      setFrame((f) => f + 1);
    }, TICK_MS);
    const saver = setInterval(persist, 5_000);
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') persist();
    });
    return () => {
      clearInterval(loop);
      clearInterval(saver);
      sub.remove();
      persist();
    };
  }, [loaded, persist]);

  /** Run a player action against the live state and redraw. */
  const act = useCallback(<T,>(fn: (s: GameState, now: number) => T): T => {
    const out = fn(ref.current!, Date.now());
    setFrame((f) => f + 1);
    persist();
    return out;
  }, [persist]);

  const reset = useCallback(() => {
    ref.current = newGame(Date.now());
    ref.current.seenIntro = true;
    persist();
    setFrame((f) => f + 1);
  }, [persist]);

  return { s: ref.current, loaded, act, reset };
}
