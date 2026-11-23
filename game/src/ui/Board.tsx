import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent, HostInstance } from 'react-native';
import { DOOR, GRID_H, GRID_W, GUEST_STEP_MS, ITEMS, STAFF_STEP_MS, STAFF_TIRED_STEP_MS, dishById } from '../game/data';
import { canPlace, isReady, itemById } from '../game/engine';
import type { Fx, GameState, Guest, Item, Staff } from '../game/engine';
import { C, native } from './theme';

export type Build = { placing?: Item['kind']; selected?: string } | null;

interface Props {
  s: GameState;
  now: number;
  size: number;
  build: Build;
  onTile: (x: number, y: number) => void;
}

export function Board({ s, now, size, build, onTile }: Props) {
  const ts = size / GRID_W;
  const ref = useRef<HostInstance>(null);
  // Work out the tile from the tap position in the window and the board position in the window.
  // locationX is relative to whichever child was hit, which differs between iOS and web.
  const onPress = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    ref.current?.measureInWindow((bx, by) => {
      const x = Math.floor((pageX - bx) / ts);
      const y = Math.floor((pageY - by) / ts);
      if (x >= 0 && y >= 0 && x < GRID_W && y < GRID_H) onTile(x, y);
    });
  };
  const moving = build?.selected;
  const showSpots = !!build && (!!build.placing || !!moving);

  return (
    <Pressable ref={ref} onPress={onPress} style={[styles.board, { width: size, height: ts * GRID_H }]}>
      <Floor ts={ts} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {showSpots &&
          Array.from({ length: GRID_W * GRID_H }, (_, i) => {
            const x = i % GRID_W;
            const y = Math.floor(i / GRID_W);
            if (!canPlace(s, x, y, moving)) return null;
            return <View key={i} style={[styles.spot, { left: x * ts + 3, top: y * ts + 3, width: ts - 6, height: ts - 6 }]} />;
          })}
        {s.items.map((it) => (
          <ItemView key={it.id} it={it} ts={ts} now={now} selected={build?.selected === it.id} />
        ))}
        {s.guests.map((g) => (
          <GuestView key={g.id} g={g} s={s} ts={ts} now={now} />
        ))}
        {s.staff.map((z) => (
          <StaffView key={z.id} z={z} ts={ts} />
        ))}
        {s.fx.map((f) => (
          <FxView key={f.id} f={f} ts={ts} />
        ))}
      </View>
    </Pressable>
  );
}

const Floor = memo(function Floor({ ts }: { ts: number }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: GRID_W * GRID_H }, (_, i) => {
        const x = i % GRID_W;
        const y = Math.floor(i / GRID_W);
        const door = x === DOOR.x && y === DOOR.y;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: x * ts,
              top: y * ts,
              width: ts,
              height: ts,
              backgroundColor: door ? '#3b2a1e' : (x + y) % 2 ? C.floorA : C.floorB,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {door ? <Text style={{ fontSize: ts * 0.55 }}>🚪</Text> : null}
          </View>
        );
      })}
    </View>
  );
});

// ---------------------------------------------------------------- furniture

function ItemView({ it, ts, now, selected }: { it: Item; ts: number; now: number; selected: boolean }) {
  const def = ITEMS[it.kind];
  const ready = it.kind === 'stove' && isReady(it, now);
  const pulse = usePulse(ready);
  const box = { position: 'absolute' as const, left: it.x * ts, top: it.y * ts, width: ts, height: ts };
  const emoji = { fontSize: ts * 0.5 };

  let body;
  if (it.kind === 'stove') {
    const c = it.cook;
    const p = c ? Math.min(1, (now - c.startedAt) / (c.readyAt - c.startedAt)) : 0;
    body = (
      <View style={[styles.block, { backgroundColor: '#3d3150', borderColor: ready ? C.zombie : '#54456d' }]}>
        <Animated.Text style={[ready ? { fontSize: ts * 0.48 } : emoji, { transform: [{ scale: pulse }] }]}>
          {ready ? dishById(c!.dish).emoji : '🍳'}
        </Animated.Text>
        {c && !ready ? (
          <>
            <Text style={[styles.corner, { fontSize: ts * 0.24 }]}>{dishById(c.dish).emoji}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { backgroundColor: C.coin, transform: [{ scaleX: p }] }]} />
            </View>
          </>
        ) : null}
        {ready ? <Badge text={`${c!.servings}`} color={C.zombie} ts={ts} /> : null}
      </View>
    );
  } else if (it.kind === 'counter') {
    body = (
      <View style={[styles.block, { backgroundColor: C.wood, borderColor: C.woodDark }]}>
        <Text style={emoji}>{it.stock && it.stock.servings > 0 ? dishById(it.stock.dish).emoji : '🍽️'}</Text>
        {it.stock && it.stock.servings > 0 ? <Badge text={`${it.stock.servings}`} color={C.coin} ts={ts} /> : null}
      </View>
    );
  } else if (it.kind === 'table') {
    body = (
      <View style={[styles.table, { borderRadius: ts }]}>
        <Text style={{ fontSize: ts * 0.3, opacity: it.dirty ? 1 : 0.35 }}>{it.dirty ? '🫧' : '🍴'}</Text>
      </View>
    );
  } else {
    body = <Text style={[emoji, { fontSize: ts * 0.58 }]}>{def.emoji}</Text>;
  }

  return (
    <View style={[box, styles.center, selected && styles.selected]}>
      {body}
    </View>
  );
}

function Badge({ text, color, ts }: { text: string; color: string; ts: number }) {
  return (
    <View style={[styles.badge, { backgroundColor: color, minWidth: ts * 0.34, height: ts * 0.3, borderRadius: ts * 0.15 }]}>
      <Text style={[styles.badgeText, { fontSize: ts * 0.19 }]}>{text}</Text>
    </View>
  );
}

function usePulse(on: boolean) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1.15, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: native }),
        Animated.timing(v, { toValue: 1, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, v]);
  return v;
}

// ---------------------------------------------------------------- people

/** Glides to each new tile over one step, so movement looks continuous at 10 ticks a second. */
function useGlide(x: number, y: number, ts: number, ms: number, offset = { x: 0, y: 0 }) {
  const tx = x * ts + offset.x * ts;
  const ty = y * ts + offset.y * ts;
  const pos = useRef(new Animated.ValueXY({ x: tx, y: ty })).current;
  useEffect(() => {
    Animated.timing(pos, { toValue: { x: tx, y: ty }, duration: ms, easing: Easing.linear, useNativeDriver: native }).start();
  }, [tx, ty, ms, pos]);
  return pos;
}

function useBob(speed: number) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: speed, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: speed, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [speed, v]);
  return v;
}

function StaffView({ z, ts }: { z: Staff; ts: number }) {
  const tired = z.energy <= 0;
  const pos = useGlide(z.x, z.y, ts, tired ? STAFF_TIRED_STEP_MS : STAFF_STEP_MS);
  const bob = useBob(tired ? 900 : 380);
  const lift = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -ts * 0.06] });
  const tilt = bob.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '6deg'] });
  const cleaning = z.task?.type === 'clean' && z.task.phase === 'cleaning';
  return (
    <Animated.View style={[styles.person, { width: ts, height: ts, transform: [{ translateX: pos.x }, { translateY: pos.y }] }]}>
      <Animated.Text style={{ fontSize: ts * 0.62, transform: [{ translateY: lift }, { rotate: tilt }] }}>{z.look}</Animated.Text>
      {z.carrying ? (
        <View style={[styles.carry, { top: -ts * 0.08 }]}>
          <Text style={{ fontSize: ts * 0.3 }}>{dishById(z.carrying.dish).emoji}</Text>
        </View>
      ) : null}
      {cleaning ? <Text style={[styles.carry, { top: -ts * 0.05, fontSize: ts * 0.3 }]}>🧽</Text> : null}
      {tired ? <Text style={[styles.zzz, { fontSize: ts * 0.26 }]}>💤</Text> : null}
      <View style={[styles.energyTrack, { width: ts * 0.6 }]}>
        <View style={[styles.energyFill, { backgroundColor: z.energy > 30 ? C.zombie : z.energy > 0 ? C.coin : C.danger, transform: [{ scaleX: Math.max(0.04, z.energy / 100) }] }]} />
      </View>
    </Animated.View>
  );
}

function GuestView({ g, s, ts, now }: { g: Guest; s: GameState; ts: number; now: number }) {
  // Seated guests lean towards their table, so they read as sitting at it.
  const table = itemById(s, g.tableId);
  const seated = (g.state === 'waiting' || g.state === 'eating') && table && Math.abs(table.x - g.x) + Math.abs(table.y - g.y) === 1;
  const offset = seated && table ? { x: (table.x - g.x) * 0.28, y: (table.y - g.y) * 0.28 } : { x: 0, y: 0 };
  const pos = useGlide(g.x, g.y, ts, seated ? 250 : GUEST_STEP_MS, offset);
  const bob = useBob(g.state === 'eating' ? 220 : 520);
  const lift = bob.interpolate({ inputRange: [0, 1], outputRange: [0, g.state === 'waiting' ? 0 : -ts * 0.05] });
  const left = g.state === 'waiting' ? Math.max(0, (g.patienceUntil - now) / g.patienceMs) : 0;

  let bubble: string | null = null;
  if (g.state === 'waiting') bubble = g.order ? dishById(g.order).emoji : '❔';
  if (g.state === 'eating') bubble = dishById(g.order!).emoji;
  if (g.state === 'leaving') bubble = g.mood === 'angry' ? '😠' : '😋';

  return (
    <Animated.View style={[styles.person, { width: ts, height: ts, transform: [{ translateX: pos.x }, { translateY: pos.y }] }]}>
      <Animated.Text style={{ fontSize: ts * 0.56, transform: [{ translateY: lift }] }}>{g.look}</Animated.Text>
      {bubble ? (
        <View style={[styles.bubble, { top: -ts * 0.2, borderRadius: ts * 0.2, paddingHorizontal: ts * 0.06 }]}>
          <Text style={{ fontSize: ts * 0.24 }}>{bubble}</Text>
        </View>
      ) : null}
      {g.state === 'waiting' ? (
        <View style={[styles.energyTrack, { width: ts * 0.6 }]}>
          <View style={[styles.energyFill, { backgroundColor: left > 0.5 ? C.zombie : left > 0.25 ? C.coin : C.danger, transform: [{ scaleX: Math.max(0.04, left) }] }]} />
        </View>
      ) : null}
    </Animated.View>
  );
}

// ---------------------------------------------------------------- floating text

function FxView({ f, ts }: { f: Fx; ts: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 1_300, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [t]);
  const color = f.tone === 'coin' ? C.coin : f.tone === 'bad' ? C.danger : C.zombie;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: f.x * ts - ts,
        top: f.y * ts,
        width: ts * 3,
        alignItems: 'center',
        opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -ts * 0.9] }) }, { scale: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.1, 1] }) }],
      }}
    >
      <Text style={[styles.fx, { color, fontSize: ts * 0.3 }]}>{f.tone === 'coin' ? `🪙${f.text}` : f.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  board: { borderRadius: 18, overflow: 'hidden', borderWidth: 2, borderColor: C.line, backgroundColor: C.floorB },
  center: { alignItems: 'center', justifyContent: 'center' },
  spot: { position: 'absolute', borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(143,227,107,0.55)', backgroundColor: 'rgba(143,227,107,0.08)' },
  selected: { borderWidth: 3, borderColor: C.coin, borderRadius: 12, backgroundColor: 'rgba(255,210,94,0.15)' },
  block: { width: '84%', height: '84%', borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  table: { width: '74%', height: '74%', backgroundColor: '#5a3f7a', borderWidth: 3, borderColor: '#7b5aa3', alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', top: 1, right: 2 },
  barTrack: { position: 'absolute', left: 5, right: 5, bottom: 4, height: 5, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.45)', overflow: 'hidden' },
  barFill: { width: '100%', height: '100%', transformOrigin: 'left' },
  badge: { position: 'absolute', top: -4, right: -4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#1a1226', fontWeight: '900' },
  person: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center' },
  carry: { position: 'absolute', right: 0 },
  zzz: { position: 'absolute', top: -2, left: 2 },
  bubble: { position: 'absolute', right: -4, backgroundColor: '#f3ecff', borderWidth: 1, borderColor: '#cbbde6' },
  energyTrack: { position: 'absolute', bottom: 2, height: 4, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.5)', overflow: 'hidden' },
  energyFill: { width: '100%', height: '100%', transformOrigin: 'left' },
  fx: { fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
});
