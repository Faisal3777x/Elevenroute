// The diner in an isometric (2.5D) view: a raised floor slab, two back walls with a door and
// moonlit windows, furniture drawn as solid blocks, and people standing on shadows. Drag to
// look around, pinch or use the buttons to zoom. Everything scales with `tw`, the tile width.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { HostInstance, LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Polygon, Rect } from 'react-native-svg';
import { DOOR, GUEST_STEP_MS, ITEMS, dishById } from '../game/data';
import type { DishId, ItemKind } from '../game/data';
import { canPlace, isReady, itemById, stepMs } from '../game/engine';
import type { Fx, GameState, Guest, Staff } from '../game/engine';
import { C, native } from './theme';

export type Build = { placing?: ItemKind; selected?: string } | null;

interface Props {
  s: GameState;
  now: number;
  build: Build;
  onTile: (x: number, y: number) => void;
  onGuest: (id: string) => void;
}

// ---------------------------------------------------------------- geometry

interface Geo {
  size: number;
  tw: number;
  th: number;
  wallH: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

function geo(size: number, tw: number): Geo {
  const th = tw / 2;
  const wallH = tw * 1.15;
  const oy = wallH + tw * 0.35;
  return { size, tw, th, wallH, ox: size * th + tw * 0.1, oy, w: size * tw + tw * 0.2, h: oy + size * th + tw * 0.55 };
}

/** Screen position of a grid corner. */
const corner = (g: Geo, x: number, y: number) => ({ x: g.ox + ((x - y) * g.tw) / 2, y: g.oy + ((x + y) * g.th) / 2 });
/** Screen position of a tile's centre. */
const centre = (g: Geo, x: number, y: number) => corner(g, x + 0.5, y + 0.5);
const pts = (...p: { x: number; y: number }[]) => p.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');

function toTile(g: Geo, px: number, py: number) {
  const a = (px - g.ox) / (g.tw / 2);
  const b = (py - g.oy) / (g.th / 2);
  return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) };
}

/** How tall each thing stands, in tile widths, for tap targets. */
const HEIGHT: Record<ItemKind, number> = { stove: 0.62, counter: 0.6, table: 0.5, web: 0.7, pumpkin: 0.65, candles: 0.75, tombstone: 0.75, crystal: 0.75, skull: 0.75 };

// ---------------------------------------------------------------- board

export function Board({ s, now, build, onTile, onGuest }: Props) {
  const [view, setView] = useState({ w: 0, h: 0 });
  const [tw, setTw] = useState(0);
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panAt = useRef({ x: 0, y: 0 });
  const origin = useRef({ x: 0, y: 0 });
  const box = useRef<HostInstance>(null);
  const fitted = useRef({ size: 0, w: 0 });

  const g = useMemo(() => geo(s.size, tw || 40), [s.size, tw]);
  const live = useRef({ g, s, build, onTile, onGuest, tw, view });
  live.current = { g, s, build, onTile, onGuest, tw, view };

  const fitTw = (size: number) => {
    const v = live.current.view;
    return Math.max(28, Math.min(v.w / (size + 0.3), (v.h - 8) / (size / 2 + 1.75)));
  };
  const setPan = (x: number, y: number, gg: Geo) => {
    const v = live.current.view;
    const slackX = v.w * 0.35;
    const slackY = v.h * 0.35;
    const cx = Math.min(Math.max(x, Math.min(0, v.w - gg.w) - slackX), Math.max(0, v.w - gg.w) + slackX);
    const cy = Math.min(Math.max(y, Math.min(0, v.h - gg.h) - slackY), Math.max(0, v.h - gg.h) + slackY);
    panAt.current = { x: cx, y: cy };
    pan.setValue(panAt.current);
  };
  const fit = (size: number, closer = 1) => {
    const v = live.current.view;
    const t = fitTw(size) * closer;
    const gg = geo(size, t);
    setTw(t);
    setPan((v.w - gg.w) / 2, (v.h - gg.h) / 2, gg);
  };
  /** Zoom about a point in the viewport, keeping what is under it in place. */
  const zoomTo = (next: number, mx: number, my: number, fromTw = live.current.tw, fromPan = panAt.current) => {
    const size = live.current.s.size;
    const t = Math.max(fitTw(size) * 0.75, Math.min(130, next));
    const k = t / fromTw;
    setTw(t);
    setPan(mx - (mx - fromPan.x) * k, my - (my - fromPan.y) * k, geo(size, t));
  };

  // Fit the room when the view first appears, and again when the room grows.
  useEffect(() => {
    if (!view.w) return;
    if (fitted.current.size !== s.size || fitted.current.w !== view.w) {
      fitted.current = { size: s.size, w: view.w };
      fit(s.size, 1.12);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.w, view.h, s.size]);

  const tap = (px: number, py: number) => {
    const { g, s, build, onTile, onGuest } = live.current;
    // People thinking about joining come first, then furniture front to back, then the floor.
    for (const q of s.guests) {
      if (q.state !== 'pondering') continue;
      const c = centre(g, q.x, q.y);
      if (Math.abs(px - c.x) < g.tw * 0.45 && py > c.y - g.tw * 1.2 && py < c.y + g.th * 0.4) return onGuest(q.id);
    }
    if (!build?.placing) {
      const front = [...s.items].sort((a, b) => b.x + b.y - (a.x + a.y));
      for (const it of front) {
        const c = centre(g, it.x, it.y);
        if (Math.abs(px - c.x) < g.tw * 0.42 && py > c.y - g.tw * HEIGHT[it.kind] && py < c.y + g.th * 0.45) return onTile(it.x, it.y);
      }
    }
    const t = toTile(g, px, py);
    if (t.x >= 0 && t.y >= 0 && t.x < s.size && t.y < s.size) onTile(t.x, t.y);
  };

  const gesture = useRef({ start: { x: 0, y: 0 }, moved: false, pinch: null as null | { d: number; tw: number; pan: { x: number; y: number } }, t0: 0, page: { x: 0, y: 0 } });
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          box.current?.measureInWindow((x, y) => (origin.current = { x, y }));
          gesture.current = { start: { ...panAt.current }, moved: false, pinch: null, t0: Date.now(), page: { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY } };
        },
        onPanResponderMove: (e, gs) => {
          const touches = e.nativeEvent.touches;
          const st = gesture.current;
          if (touches && touches.length >= 2) {
            const [a, b] = touches;
            const d = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
            const mx = (a.pageX + b.pageX) / 2 - origin.current.x;
            const my = (a.pageY + b.pageY) / 2 - origin.current.y;
            if (!st.pinch) st.pinch = { d, tw: live.current.tw, pan: { ...panAt.current } };
            st.moved = true;
            zoomTo((st.pinch.tw * d) / st.pinch.d, mx, my, st.pinch.tw, st.pinch.pan);
            return;
          }
          if (st.pinch) return;
          if (!st.moved && Math.hypot(gs.dx, gs.dy) < 8) return;
          st.moved = true;
          setPan(st.start.x + gs.dx, st.start.y + gs.dy, live.current.g);
        },
        onPanResponderRelease: () => {
          const st = gesture.current;
          if (st.moved || Date.now() - st.t0 > 700) return;
          tap(st.page.x - origin.current.x - panAt.current.x, st.page.y - origin.current.y - panAt.current.y);
        },
      }),
    // The handlers read everything live through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    live.current.view = { w: width, h: height };
    setView({ w: width, h: height });
    box.current?.measureInWindow((x, y) => (origin.current = { x, y }));
  };

  // Valid spots while building, as a string so the room only redraws when they change.
  const layoutKey = s.items.map((i) => `${i.x},${i.y}`).join(';');
  const spots = useMemo(() => {
    if (!build || (!build.placing && !build.selected)) return '';
    const out: string[] = [];
    for (let y = 0; y < s.size; y++) for (let x = 0; x < s.size; x++) if (canPlace(s, x, y, build.selected)) out.push(`${x},${y}`);
    return out.join(';');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build, s.size, layoutKey]);
  const selected = build?.selected ? itemById(s, build.selected) : undefined;

  // Furniture and people, back to front.
  const sprites: { depth: number; node: ReactNode }[] = [];
  if (tw) {
    for (const it of s.items) {
      const c = centre(g, it.x, it.y);
      sprites.push({
        depth: it.x + it.y,
        node: (
          <ItemSprite
            key={it.id}
            kind={it.kind}
            left={c.x - g.tw / 2}
            top={c.y - g.tw * 1.5 + g.th / 2}
            tw={g.tw}
            cookDish={it.cook?.dish}
            cookP={it.cook ? Math.min(1, Math.round(((now - it.cook.startedAt) / (it.cook.readyAt - it.cook.startedAt)) * 50) / 50) : 0}
            ready={it.kind === 'stove' && isReady(it, now)}
            servings={it.cook?.servings ?? 0}
            stockDish={it.stock && it.stock.servings > 0 ? it.stock.dish : undefined}
            stockN={it.stock?.servings ?? 0}
            dirty={!!it.dirty}
          />
        ),
      });
    }
    for (const q of s.guests) sprites.push({ depth: q.x + q.y + 0.6, node: <GuestSprite key={q.id} q={q} s={s} g={g} now={now} /> });
    for (const z of s.staff) sprites.push({ depth: z.x + z.y + 0.5, node: <StaffSprite key={z.id} z={z} g={g} now={now} /> });
    sprites.sort((a, b) => a.depth - b.depth);
  }

  return (
    <View ref={box} style={styles.viewport} onLayout={onLayout} {...responder.panHandlers}>
      {tw ? (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: g.w, height: g.h, transform: [{ translateX: pan.x }, { translateY: pan.y }] }}>
          <Room size={s.size} tw={g.tw} spots={spots} sel={selected ? `${selected.x},${selected.y}` : ''} />
          {sprites.map((x) => x.node)}
          {s.fx.map((f) => (
            <FxView key={f.id} f={f} g={g} />
          ))}
        </Animated.View>
      ) : null}
      <View style={styles.zoom}>
        <ZoomBtn label="+" onPress={() => zoomTo(tw * 1.25, view.w / 2, view.h / 2)} />
        <ZoomBtn label="−" onPress={() => zoomTo(tw / 1.25, view.w / 2, view.h / 2)} />
        <ZoomBtn label="⤢" onPress={() => fit(s.size)} />
      </View>
    </View>
  );
}

function ZoomBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.zoomBtn, pressed && { opacity: 0.6, transform: [{ scale: 0.94 }] }]}>
      <Text style={styles.zoomText}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- the room

const Room = memo(function Room({ size, tw, spots, sel }: { size: number; tw: number; spots: string; sel: string }) {
  const g = geo(size, tw);
  const P = (x: number, y: number) => corner(g, x, y);
  const up = (p: { x: number; y: number }, h: number) => ({ x: p.x, y: p.y - h });
  const slab = tw * 0.16;
  const tiles = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const door = x === DOOR.x && y === DOOR.y;
      const fill = door ? '#5b2333' : (x + y) % 2 ? '#3a2b55' : '#33264c';
      tiles.push(<Polygon key={`t${x},${y}`} points={pts(P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1))} fill={fill} stroke="#2a1f40" strokeWidth={0.8} />);
    }
  const marks = spots
    ? spots.split(';').map((k) => {
        const [x, y] = k.split(',').map(Number);
        const c = centre(g, x, y);
        const a = tw * 0.42;
        const b = a / 2;
        return <Polygon key={`s${k}`} points={pts({ x: c.x, y: c.y - b }, { x: c.x + a, y: c.y }, { x: c.x, y: c.y + b }, { x: c.x - a, y: c.y })} fill="rgba(143,227,107,0.16)" stroke="rgba(143,227,107,0.7)" strokeWidth={1.2} strokeDasharray="4,3" />;
      })
    : null;
  let selMark = null;
  if (sel) {
    const [x, y] = sel.split(',').map(Number);
    selMark = <Polygon points={pts(P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1))} fill="rgba(255,210,94,0.2)" stroke={C.coin} strokeWidth={2.5} />;
  }

  // Back walls: the right-hand one runs along y = 0, the left-hand one along x = 0.
  const H = g.wallH;
  const band = H * 0.36;
  const R0 = P(0, 0);
  const R1 = P(size, 0);
  const L1 = P(0, size);
  const windows = [];
  for (let i = 1; i + 1 < size; i += 3) {
    const a = P(i + 0.15, 0);
    const b = P(i + 1.85, 0);
    const lo = H * 0.42;
    const hi = H * 0.88;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    windows.push(
      <G key={`w${i}`}>
        <Polygon points={pts(up(a, lo), up(b, lo), up(b, hi), up(a, hi))} fill="#1d2b55" stroke="#6b4a2e" strokeWidth={tw * 0.05} />
        <Circle cx={mx + tw * 0.25} cy={my - H * 0.7} r={tw * 0.12} fill="#fff4c2" opacity={0.9} />
        <Line x1={mx} y1={my - lo} x2={mx} y2={my - hi} stroke="#6b4a2e" strokeWidth={tw * 0.035} />
      </G>,
    );
  }
  const d0 = P(0, DOOR.y + 0.12);
  const d1 = P(0, DOOR.y + 0.88);
  const doorTop = H * 0.8;
  const lampX = (d0.x + d1.x) / 2;
  const lampY = (d0.y + d1.y) / 2 - doorTop - tw * 0.14;

  return (
    <Svg width={g.w} height={g.h} style={StyleSheet.absoluteFill}>
      {/* floor slab sides */}
      <Polygon points={pts(L1, P(size, size), up(P(size, size), -slab), up(L1, -slab))} fill="#1c1430" />
      <Polygon points={pts(R1, P(size, size), up(P(size, size), -slab), up(R1, -slab))} fill="#24193b" />
      {/* walls with a darker lower band and a lighter cap */}
      <Polygon points={pts(R0, R1, up(R1, H), up(R0, H))} fill="#4a3a6e" />
      <Polygon points={pts(R0, R1, up(R1, band), up(R0, band))} fill="#3a2d58" />
      <Polygon points={pts(R0, L1, up(L1, H), up(R0, H))} fill="#3b2d5a" />
      <Polygon points={pts(R0, L1, up(L1, band), up(R0, band))} fill="#2e2348" />
      <Polygon points={pts(up(R0, H), up(R1, H), up(R1, H + tw * 0.08), up(R0, H + tw * 0.08))} fill="#6c5596" />
      <Polygon points={pts(up(R0, H), up(L1, H), up(L1, H + tw * 0.08), up(R0, H + tw * 0.08))} fill="#5c4884" />
      {windows}
      {/* the door, with a warm lamp above it */}
      <Polygon points={pts(d0, d1, up(d1, doorTop), up(d0, doorTop))} fill="#140b20" stroke="#8a5a34" strokeWidth={tw * 0.06} />
      <Ellipse cx={lampX} cy={lampY} rx={tw * 0.3} ry={tw * 0.22} fill="#ffcf6b" opacity={0.15} />
      <Circle cx={lampX} cy={lampY} r={tw * 0.08} fill="#ffcf6b" />
      {tiles}
      {marks}
      {selMark}
    </Svg>
  );
});

// ---------------------------------------------------------------- furniture

/** The three visible faces of a block standing on a tile. (cx, cy) is the tile centre. */
function blockFaces(cx: number, cy: number, a: number, h: number) {
  const b = a / 2;
  return {
    top: pts({ x: cx, y: cy - h - b }, { x: cx + a, y: cy - h }, { x: cx, y: cy - h + b }, { x: cx - a, y: cy - h }),
    left: pts({ x: cx - a, y: cy - h }, { x: cx, y: cy - h + b }, { x: cx, y: cy + b }, { x: cx - a, y: cy }),
    right: pts({ x: cx, y: cy - h + b }, { x: cx + a, y: cy - h }, { x: cx + a, y: cy }, { x: cx, y: cy + b }),
  };
}

interface ItemSpriteProps {
  kind: ItemKind;
  left: number;
  top: number;
  tw: number;
  cookDish?: DishId;
  cookP: number;
  ready: boolean;
  servings: number;
  stockDish?: DishId;
  stockN: number;
  dirty: boolean;
}

const ItemSprite = memo(function ItemSprite({ kind, left, top, tw, cookDish, cookP, ready, servings, stockDish, stockN, dirty }: ItemSpriteProps) {
  const H = tw * 1.5;
  const cx = tw / 2;
  const cy = H - tw / 4;
  const a = tw * 0.4;
  const b = a / 2;
  const pulse = usePulse(ready);
  const wrap = { position: 'absolute' as const, left, top, width: tw, height: H };
  const shadow = <Ellipse cx={cx} cy={cy + b * 0.2} rx={a * 1.05} ry={b * 1.05} fill="rgba(0,0,0,0.35)" />;

  if (kind === 'stove') {
    const h = tw * 0.36;
    const f = blockFaces(cx, cy, a, h);
    const topY = cy - h;
    const hot = !!cookDish;
    return (
      <View style={wrap}>
        <Svg width={tw} height={H}>
          {shadow}
          <Polygon points={f.left} fill="#2c2840" />
          <Polygon points={f.right} fill="#3b3655" />
          <Polygon points={f.top} fill="#5a5478" />
          <Polygon
            points={pts({ x: cx + a * 0.18, y: cy - h + b * 0.95 }, { x: cx + a * 0.82, y: cy - h + b * 0.35 }, { x: cx + a * 0.82, y: cy - b * 0.1 }, { x: cx + a * 0.18, y: cy + b * 0.5 })}
            fill={hot ? '#ff8a3d' : '#1f1b2e'}
            opacity={hot ? 0.75 : 1}
          />
          <Ellipse cx={cx - a * 0.32} cy={topY} rx={a * 0.24} ry={b * 0.24} fill={hot ? '#ff6a2a' : '#211d31'} />
          <Ellipse cx={cx + a * 0.32} cy={topY} rx={a * 0.24} ry={b * 0.24} fill={hot ? '#ff6a2a' : '#211d31'} />
          {ready ? <Ellipse cx={cx} cy={cy} rx={a * 1.15} ry={b * 1.15} fill="none" stroke={C.zombie} strokeWidth={2.5} /> : null}
        </Svg>
        {cookDish ? (
          <Animated.Text style={[styles.onTop, { top: H - tw * 1.18, fontSize: ready ? tw * 0.46 : tw * 0.3, transform: [{ scale: pulse }] }]}>{dishById(cookDish).emoji}</Animated.Text>
        ) : null}
        {cookDish && !ready ? (
          <View style={[styles.bar, { top: H - tw * 1.22, left: tw * 0.2, width: tw * 0.6 }]}>
            <View style={[styles.barFill, { backgroundColor: C.coin, transform: [{ scaleX: Math.max(0.03, cookP) }] }]} />
          </View>
        ) : null}
        {ready ? <Badge text={`${servings}`} color={C.zombie} tw={tw} top={H - tw * 1.3} /> : null}
      </View>
    );
  }

  if (kind === 'counter') {
    const h = tw * 0.34;
    const f = blockFaces(cx, cy, a, h);
    return (
      <View style={wrap}>
        <Svg width={tw} height={H}>
          {shadow}
          <Polygon points={f.left} fill="#5e3c27" />
          <Polygon points={f.right} fill="#7a4e33" />
          <Polygon points={f.top} fill="#b07a4c" />
          <Line x1={cx - a} y1={cy - h * 0.45} x2={cx} y2={cy - h * 0.45 + b} stroke="#4a2f20" strokeWidth={1} />
          <Line x1={cx} y1={cy - h * 0.45 + b} x2={cx + a} y2={cy - h * 0.45} stroke="#5e3c27" strokeWidth={1} />
          <Ellipse cx={cx} cy={cy - h} rx={a * 0.5} ry={b * 0.5} fill="#f1e9ff" />
        </Svg>
        {stockDish ? (
          <>
            <Text style={[styles.onTop, { top: H - tw * 1.02, fontSize: tw * 0.36 }]}>{dishById(stockDish).emoji}</Text>
            <Badge text={`${stockN}`} color={C.coin} tw={tw} top={H - tw * 1.08} />
          </>
        ) : null}
      </View>
    );
  }

  if (kind === 'table') {
    const h = tw * 0.26;
    return (
      <View style={wrap}>
        <Svg width={tw} height={H}>
          <Ellipse cx={cx} cy={cy} rx={a * 0.8} ry={b * 0.8} fill="rgba(0,0,0,0.35)" />
          <Rect x={cx - tw * 0.04} y={cy - h} width={tw * 0.08} height={h} fill="#2a1d3d" />
          <Ellipse cx={cx} cy={cy} rx={a * 0.32} ry={b * 0.3} fill="#2a1d3d" />
          <Ellipse cx={cx} cy={cy - h + tw * 0.035} rx={a * 0.92} ry={b * 0.92} fill="#4a3170" />
          <Ellipse cx={cx} cy={cy - h} rx={a * 0.92} ry={b * 0.92} fill="#7a55aa" />
          <Ellipse cx={cx} cy={cy - h} rx={a * 0.66} ry={b * 0.66} fill="#8d68be" />
          <Ellipse cx={cx} cy={cy - h} rx={a * 0.28} ry={b * 0.28} fill={dirty ? '#9b8c7a' : '#f1e9ff'} />
        </Svg>
        {dirty ? <Text style={[styles.onTop, { top: H - tw * 0.78, fontSize: tw * 0.28 }]}>🫧</Text> : null}
      </View>
    );
  }

  // Decor: a prop standing on its shadow.
  return (
    <View style={wrap}>
      <Svg width={tw} height={H}>
        <Ellipse cx={cx} cy={cy} rx={a * 0.75} ry={b * 0.75} fill="rgba(0,0,0,0.35)" />
      </Svg>
      <Text style={[styles.onTop, { top: H - tw * 0.95, fontSize: tw * 0.56 }]}>{ITEMS[kind].emoji}</Text>
    </View>
  );
});

function Badge({ text, color, tw, top }: { text: string; color: string; tw: number; top: number }) {
  return (
    <View style={[styles.badge, { top, right: tw * 0.02, backgroundColor: color, minWidth: tw * 0.32, height: tw * 0.27, borderRadius: tw * 0.14 }]}>
      <Text style={[styles.badgeText, { fontSize: tw * 0.17 }]}>{text}</Text>
    </View>
  );
}

function usePulse(on: boolean, to = 1.15) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) {
      v.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: to, duration: 450, easing: Easing.out(Easing.quad), useNativeDriver: native }),
        Animated.timing(v, { toValue: 1, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, v, to]);
  return v;
}

// ---------------------------------------------------------------- people

/** Glides to each new spot over one step; jumps when the zoom changes. */
function useGlide(tx: number, ty: number, ms: number, tw: number) {
  const pos = useRef(new Animated.ValueXY({ x: tx, y: ty })).current;
  const lastTw = useRef(tw);
  useEffect(() => {
    if (lastTw.current !== tw) {
      lastTw.current = tw;
      pos.stopAnimation();
      pos.setValue({ x: tx, y: ty });
      return;
    }
    Animated.timing(pos, { toValue: { x: tx, y: ty }, duration: ms, easing: Easing.linear, useNativeDriver: native }).start();
  }, [tx, ty, ms, tw, pos]);
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

/** A person: a shadow on the floor and an emoji standing on it, plus whatever floats above. */
function Person({ pos, tw, look, lift, tilt, scale, children }: { pos: Animated.ValueXY; tw: number; look: string; lift: Animated.AnimatedInterpolation<number>; tilt?: Animated.AnimatedInterpolation<string>; scale?: Animated.Value; children?: ReactNode }) {
  const W = tw;
  const H = tw * 1.25;
  return (
    <Animated.View style={{ position: 'absolute', left: -W / 2, top: -H, width: W, height: H, transform: [{ translateX: pos.x }, { translateY: pos.y }, ...(scale ? [{ scale }] : [])] }}>
      <View style={[styles.shadow, { left: W * 0.24, width: W * 0.52, height: W * 0.2, bottom: -W * 0.08, borderRadius: W }]} />
      <Animated.Text style={[styles.person, { fontSize: tw * 0.6, bottom: -tw * 0.02, transform: [{ translateY: lift }, ...(tilt ? [{ rotate: tilt }] : [])] }]}>{look}</Animated.Text>
      {children}
    </Animated.View>
  );
}

function StaffSprite({ z, g, now }: { z: Staff; g: Geo; now: number }) {
  const tired = z.energy <= 0;
  const c = centre(g, z.x, z.y);
  const pos = useGlide(c.x, c.y, stepMs(z), g.tw);
  const bob = useBob(tired ? 900 : 380);
  const lift = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -g.tw * 0.06] });
  const tilt = bob.interpolate({ inputRange: [0, 1], outputRange: ['-7deg', '7deg'] });
  // New staff pop up out of the floor.
  const arrive = useRef(new Animated.Value(now - z.joinedAt < 1_500 ? 0.2 : 1)).current;
  useEffect(() => {
    Animated.spring(arrive, { toValue: 1, useNativeDriver: native, bounciness: 14, speed: 8 }).start();
  }, [arrive]);
  const cleaning = z.task?.type === 'clean' && z.task.phase === 'cleaning';
  const tw = g.tw;
  return (
    <Person pos={pos} tw={tw} look={z.look} lift={lift} tilt={tilt} scale={arrive}>
      {z.carrying ? <Text style={[styles.float, { top: tw * 0.55, right: -tw * 0.02, fontSize: tw * 0.3 }]}>{dishById(z.carrying.dish).emoji}</Text> : null}
      {cleaning ? <Text style={[styles.float, { top: tw * 0.6, right: 0, fontSize: tw * 0.28 }]}>🧽</Text> : null}
      {tired ? <Text style={[styles.float, { top: tw * 0.3, left: 0, fontSize: tw * 0.26 }]}>💤</Text> : null}
      <View style={[styles.bar, { top: tw * 0.5, left: tw * 0.25, width: tw * 0.5, height: 4 }]}>
        <View style={[styles.barFill, { backgroundColor: z.energy > 30 ? C.zombie : z.energy > 0 ? C.coin : C.danger, transform: [{ scaleX: Math.max(0.04, z.energy / 100) }] }]} />
      </View>
    </Person>
  );
}

function GuestSprite({ q, s, g, now }: { q: Guest; s: GameState; g: Geo; now: number }) {
  // Seated guests lean towards their table, so they read as sitting at it.
  const table = itemById(s, q.tableId);
  const seated = (q.state === 'waiting' || q.state === 'eating' || q.state === 'pondering') && table && Math.abs(table.x - q.x) + Math.abs(table.y - q.y) === 1;
  const ox = seated && table ? (table.x - q.x) * 0.3 : 0;
  const oy = seated && table ? (table.y - q.y) * 0.3 : 0;
  const c = centre(g, q.x + ox, q.y + oy);
  const pos = useGlide(c.x, c.y, seated ? 250 : GUEST_STEP_MS, g.tw);
  const bob = useBob(q.state === 'eating' ? 220 : 520);
  const lift = bob.interpolate({ inputRange: [0, 1], outputRange: [0, q.state === 'waiting' ? 0 : -g.tw * 0.05] });
  const pondering = q.state === 'pondering';
  const pulse = usePulse(pondering, 1.12);
  const left = q.state === 'waiting' ? Math.max(0, (q.patienceUntil - now) / q.patienceMs) : 0;
  const tw = g.tw;

  let bubble: string | null = null;
  if (q.state === 'waiting') bubble = q.order ? dishById(q.order).emoji : '❔';
  if (q.state === 'eating') bubble = dishById(q.order!).emoji;
  if (q.state === 'leaving') bubble = q.mood === 'angry' ? '😠' : '😋';

  return (
    <Person pos={pos} tw={tw} look={q.look} lift={lift}>
      {bubble ? (
        <View style={[styles.bubble, { top: tw * 0.36, right: -tw * 0.16, borderRadius: tw * 0.2, paddingHorizontal: tw * 0.05 }]}>
          <Text style={{ fontSize: tw * 0.24 }}>{bubble}</Text>
        </View>
      ) : null}
      {pondering ? (
        <Animated.View style={[styles.join, { top: tw * 0.12, left: -tw * 0.4, right: -tw * 0.4, transform: [{ scale: pulse }] }]}>
          <Text style={[styles.joinText, { fontSize: Math.max(10, tw * 0.2) }]}>🧟 Join?</Text>
        </Animated.View>
      ) : null}
      {q.state === 'waiting' ? (
        <View style={[styles.bar, { top: tw * 0.5, left: tw * 0.25, width: tw * 0.5, height: 4 }]}>
          <View style={[styles.barFill, { backgroundColor: left > 0.5 ? C.zombie : left > 0.25 ? C.coin : C.danger, transform: [{ scaleX: Math.max(0.04, left) }] }]} />
        </View>
      ) : null}
    </Person>
  );
}

// ---------------------------------------------------------------- floating text

function FxView({ f, g }: { f: Fx; g: Geo }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 1_300, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [t]);
  const c = centre(g, f.x, f.y);
  const color = f.tone === 'coin' ? C.coin : f.tone === 'bad' ? C.danger : C.zombie;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: c.x - g.tw * 1.5,
        top: c.y - g.tw * 1.1,
        width: g.tw * 3,
        alignItems: 'center',
        opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -g.tw * 0.8] }) }, { scale: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.6, 1.1, 1] }) }],
      }}
    >
      <Text style={[styles.fx, { color, fontSize: Math.max(12, g.tw * 0.28) }]}>{f.tone === 'coin' ? `🪙${f.text}` : f.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  zoom: { position: 'absolute', right: 10, top: 6, gap: 8 },
  zoomBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(30,22,48,0.9)', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  zoomText: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: -2 },
  onTop: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  bar: { position: 'absolute', height: 5, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.55)', overflow: 'hidden' },
  barFill: { width: '100%', height: '100%', transformOrigin: 'left' },
  badge: { position: 'absolute', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#1a1226', fontWeight: '900' },
  shadow: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.38)' },
  person: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  float: { position: 'absolute' },
  bubble: { position: 'absolute', backgroundColor: '#f3ecff', borderWidth: 1, borderColor: '#cbbde6' },
  join: { position: 'absolute', alignItems: 'center' },
  joinText: { backgroundColor: C.zombie, color: '#1a1226', fontWeight: '900', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, overflow: 'hidden' },
  fx: { fontWeight: '900', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
});
