import { createAudioPlayer } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import type { Sfx } from '../game/engine';

// The sounds are synthesized by scripts/make-sfx.mjs.
const FILES: Record<Sfx, number> = {
  coin: require('../../assets/sfx/coin.wav'),
  ding: require('../../assets/sfx/ding.wav'),
  place: require('../../assets/sfx/place.wav'),
  level: require('../../assets/sfx/level.wav'),
  angry: require('../../assets/sfx/angry.wav'),
  recruit: require('../../assets/sfx/recruit.wav'),
  cook: require('../../assets/sfx/cook.wav'),
  sell: require('../../assets/sfx/sell.wav'),
  coffee: require('../../assets/sfx/coffee.wav'),
  goal: require('../../assets/sfx/goal.wav'),
};

const VOLUME: Partial<Record<Sfx, number>> = { coin: 0.5, cook: 0.6, place: 0.7, angry: 0.6 };
const players: Partial<Record<Sfx, AudioPlayer>> = {};

/** Play a sound effect. Sound is a nicety, so failures are ignored. */
export function play(name: Sfx) {
  try {
    let p = players[name];
    if (!p) {
      p = createAudioPlayer(FILES[name]);
      p.volume = VOLUME[name] ?? 0.8;
      players[name] = p;
    }
    void p.seekTo(0);
    p.play();
  } catch {
    // No audio on this device; carry on silently.
  }
}
