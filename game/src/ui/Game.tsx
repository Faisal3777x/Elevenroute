import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DISHES, ESPRESSO_COST, ITEMS, PACES, ROOMS, dishById, hireCost, maxOf, maxStaff, sellValue, xpForLevel } from '../game/data';
import type { ItemGroup, ItemKind } from '../game/data';
import {
  buy,
  claimGoal,
  cook,
  countOf,
  currentGoal,
  discard,
  espresso,
  expand,
  goalProgress,
  hire,
  isReady,
  itemAt,
  itemById,
  move,
  nextRoom,
  note,
  quickServe,
  recruit,
  sell,
  spook,
  tipBonus,
} from '../game/engine';
import type { GameState, Result, Staff } from '../game/engine';
import { Board } from './Board';
import type { Build } from './Board';
import { Sheet } from './Sheet';
import { play } from './sound';
import { C, buzz, duration, native, num } from './theme';
import { useGame } from './useGame';

type Panel = null | { kind: 'stove'; id: string } | { kind: 'shop' } | { kind: 'staff' } | { kind: 'menu' };
type ShopTab = ItemGroup | 'room';

export function Game() {
  const { s, loaded, act, reset } = useGame();
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState<Panel>(null);
  const [build, setBuild] = useState<Build>(null);
  const [shopTab, setShopTab] = useState<ShopTab>('kitchen');

  // Play whatever the last tick or action asked for.
  useEffect(() => {
    if (!s || s.sfx.length === 0) return;
    if (!s.muted) for (const x of s.sfx) play(x);
    s.sfx.length = 0;
  });

  if (!loaded || !s) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={{ fontSize: 64 }}>🧟</Text>
        <Text style={styles.muted}>Unlocking the diner…</Text>
      </View>
    );
  }

  const now = Date.now();

  const run = (fn: (s: GameState, now: number) => Result | void, good: 'tap' | 'ok' = 'ok') => {
    const r = act(fn);
    if (r && !r.ok) {
      buzz('no');
      if (r.msg) act((st, t) => note(st, r.msg!, t));
    } else buzz(good);
    return r ?? { ok: true };
  };

  const onGuest = (id: string) => {
    if (build) return;
    if (run((st, t) => recruit(st, id, t)).ok) buzz('win');
  };

  const onTile = (x: number, y: number) => {
    const it = itemAt(s, x, y);
    if (build) {
      if (build.placing) {
        if (it) return run((st, t) => note(st, 'Pick an empty tile.', t));
        const kind = build.placing;
        const r = run((st, t) => buy(st, kind, x, y, t));
        if (r.ok) setBuild({});
        return;
      }
      if (build.selected) {
        if (it?.id === build.selected) return setBuild({});
        if (it) {
          buzz();
          return setBuild({ selected: it.id });
        }
        const id = build.selected;
        const r = run((st) => move(st, id, x, y));
        if (r.ok) setBuild({});
        return;
      }
      if (it) {
        buzz();
        setBuild({ selected: it.id });
      }
      return;
    }
    const thinker = s.guests.find((g) => g.state === 'pondering' && ((g.x === x && g.y === y) || (it && g.tableId === it.id)));
    if (thinker) return onGuest(thinker.id);
    if (it?.kind === 'stove') {
      if (isReady(it, now)) run((st, t) => quickServe(st, it.id, t));
      else {
        buzz();
        setPanel({ kind: 'stove', id: it.id });
      }
      return;
    }
    if (it?.kind === 'counter') {
      buzz();
      const st = it.stock;
      act((g, t) => note(g, st && st.servings > 0 ? `${st.servings} × ${dishById(st.dish).name} ready to serve.` : 'Empty. Cook something and your zombies bring it here.', t));
      return;
    }
    if (s.staff.some((z) => z.x === x && z.y === y)) {
      buzz();
      setPanel({ kind: 'staff' });
    }
  };

  const nextXp = xpForLevel(s.level);
  const prevXp = s.level > 1 ? xpForLevel(s.level - 1) : 0;
  const xpP = Math.max(0, Math.min(1, (s.xp - prevXp) / (nextXp - prevXp)));
  const sleepy = s.staff.filter((z) => z.energy < 30).length;
  const stove = panel?.kind === 'stove' ? itemById(s, panel.id) : undefined;
  const selected = build?.selected ? itemById(s, build.selected) : undefined;
  const goal = currentGoal(s);
  const room = nextRoom(s);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      {/* ---------------- HUD */}
      <View style={styles.hud}>
        <Pill>
          <Text style={styles.pillIcon}>🪙</Text>
          <Text style={[styles.pillText, { color: C.coin }]}>{num(s.coins)}</Text>
        </Pill>
        <Pressable onPress={() => setPanel({ kind: 'menu' })} style={({ pressed }) => [styles.level, pressed && styles.pressed]}>
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>{s.level}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.levelLabel} numberOfLines={1}>
              Night Bite Diner
            </Text>
            <View style={styles.xpTrack}>
              <View style={[styles.xpFill, { transform: [{ scaleX: Math.max(0.02, xpP) }] }]} />
            </View>
          </View>
        </Pressable>
        <Pill onPress={() => setPanel({ kind: 'menu' })}>
          <Text style={styles.pillIcon}>⭐</Text>
          <Text style={styles.pillText}>{s.rating.toFixed(1)}</Text>
        </Pill>
      </View>

      {goal ? <GoalBanner text={goal.text} have={Math.min(goalProgress(s, goal), goal.target)} need={goal.target} reward={goal.reward} onClaim={() => run((st, t) => claimGoal(st, t))} /> : null}

      {/* ---------------- the diner */}
      <View style={{ flex: 1, marginBottom: insets.bottom + 78 }}>
        <Board s={s} now={now} build={build} onTile={onTile} onGuest={onGuest} />
      </View>

      <Toast text={s.toast?.text ?? null} stamp={s.toast?.at ?? 0} top={insets.top + 104} />

      {/* ---------------- bottom bar */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 8 }]}>
        {build ? (
          <View style={styles.buildBar}>
            <Text style={styles.buildHint} numberOfLines={2}>
              {build.placing
                ? `Tap a glowing tile to place the ${ITEMS[build.placing].name.toLowerCase()} (${ITEMS[build.placing].cost} 🪙).`
                : selected
                  ? `Tap a tile to move the ${ITEMS[selected.kind].name.toLowerCase()}, or sell it for ${sellValue(selected.kind)} 🪙.`
                  : 'Tap anything to move or sell it. Drag to look around.'}
            </Text>
            <View style={styles.row}>
              {selected ? (
                <Btn
                  tone="danger"
                  label="Sell"
                  onPress={() => {
                    const id = selected.id;
                    if (run((st, t) => sell(st, id, t)).ok) setBuild({});
                  }}
                />
              ) : null}
              {build.placing || selected ? <Btn tone="ghost" label="Cancel" onPress={() => setBuild({})} /> : null}
              <Btn tone="go" label="Done" onPress={() => setBuild(null)} />
            </View>
          </View>
        ) : (
          <View style={styles.row}>
            <BarButton icon="🛒" label="Shop" onPress={() => setPanel({ kind: 'shop' })} />
            <BarButton icon="🧟" label="Staff" onPress={() => setPanel({ kind: 'staff' })} badge={sleepy > 0 ? `${sleepy}` : undefined} />
            <BarButton icon="🔨" label="Build" onPress={() => setBuild({})} />
            <BarButton icon="☕" label="Coffee" onPress={() => run((st) => espresso(st, 'all'))} />
          </View>
        )}
      </View>

      {/* ---------------- stove */}
      <Sheet open={panel?.kind === 'stove'} onClose={() => setPanel(null)} title={stove?.cook ? 'On the stove' : 'What’s cooking?'}>
        {stove?.cook ? (
          <StoveStatus
            dish={stove.cook.dish}
            left={stove.cook.readyAt - now}
            p={(now - stove.cook.startedAt) / (stove.cook.readyAt - stove.cook.startedAt)}
            onDiscard={() => {
              const id = stove.id;
              run((st) => discard(st, id));
            }}
          />
        ) : (
          DISHES.map((d) => {
            const locked = d.level > s.level;
            const poor = s.coins < d.cost;
            return (
              <Row
                key={d.id}
                icon={d.emoji}
                title={d.name}
                detail={locked ? `Unlocks at level ${d.level}` : `${duration(d.cookMs)} · ${d.servings} servings · earns ${d.servings * d.price} 🪙`}
                dim={locked}
                right={<Price amount={d.cost} short={poor && !locked} locked={locked} />}
                onPress={() => {
                  if (!stove) return;
                  const id = stove.id;
                  if (run((st, t) => cook(st, id, d.id, t)).ok) setPanel(null);
                }}
              />
            );
          })
        )}
      </Sheet>

      {/* ---------------- shop */}
      <Sheet open={panel?.kind === 'shop'} onClose={() => setPanel(null)} title="Shop">
        <Segmented
          value={shopTab}
          options={[
            ['kitchen', 'Kitchen'],
            ['dining', 'Dining'],
            ['decor', 'Decor'],
            ['room', 'Room'],
          ]}
          onChange={setShopTab}
        />
        {shopTab === 'room' ? (
          <>
            {ROOMS.map((r) => {
              const owned = r.size <= s.size;
              const isNext = room?.size === r.size;
              const locked = r.level > s.level;
              return (
                <Row
                  key={r.size}
                  icon={owned ? '✅' : locked ? '🔒' : '🧱'}
                  title={`${r.size} × ${r.size} diner`}
                  detail={owned ? 'Yours' : locked ? `Unlocks at level ${r.level}` : isNext ? 'Knock through the walls for more space' : 'Expand step by step'}
                  dim={!owned && (!isNext || locked)}
                  right={owned ? undefined : <Price amount={r.cost} short={s.coins < r.cost && !locked} locked={locked} />}
                  onPress={
                    isNext
                      ? () => {
                          if (run((st, t) => expand(st, t)).ok) setPanel(null);
                        }
                      : undefined
                  }
                />
              );
            })}
            <Text style={styles.note}>Expanding keeps everything where it is and adds room along the front.</Text>
          </>
        ) : (
          (Object.keys(ITEMS) as ItemKind[])
            .filter((k) => ITEMS[k].group === shopTab)
            .map((k) => {
              const def = ITEMS[k];
              const locked = def.level > s.level;
              const max = maxOf(k, s.level);
              const full = countOf(s, k) >= max;
              const owned = Number.isFinite(max) ? `${countOf(s, k)}/${max} owned` : `${countOf(s, k)} owned`;
              const extra = def.spook ? ` · +${def.spook} spook` : '';
              return (
                <Row
                  key={k}
                  icon={def.emoji}
                  title={def.name}
                  detail={locked ? `Unlocks at level ${def.level}` : full ? `${owned} · level up for more` : `${def.blurb}${extra} · ${owned}`}
                  dim={locked || full}
                  right={<Price amount={def.cost} short={s.coins < def.cost && !locked} locked={locked} />}
                  onPress={() => {
                    if (locked || full || s.coins < def.cost) {
                      buzz('no');
                      act((st, t) => note(st, locked ? `${def.name} unlocks at level ${def.level}.` : full ? 'Level up to own more of these.' : `You need ${def.cost} coins.`, t));
                      return;
                    }
                    buzz();
                    setPanel(null);
                    setBuild({ placing: k });
                  }}
                />
              );
            })
        )}
        {shopTab === 'decor' ? <Text style={styles.note}>Spooky decor makes guests more patient, more likely to join your staff, and adds 2% to every tip per point of spook (up to +50%). You have {spook(s)} spook.</Text> : null}
      </Sheet>

      {/* ---------------- staff */}
      <Sheet
        open={panel?.kind === 'staff'}
        onClose={() => setPanel(null)}
        title={`Your zombies · ${s.staff.length}/${maxStaff(s.level)}`}
        footer={
          <Btn
            tone="go"
            label={s.staff.length >= maxStaff(s.level) ? 'Level up to hire more' : `Hire a zombie · ${hireCost(s.staff.length)} 🪙`}
            onPress={() => run((st, t) => hire(st, t))}
          />
        }
      >
        {s.staff.map((z) => (
          <Row
            key={z.id}
            icon={z.look}
            title={`${z.name} · ${PACES[z.pace ?? 1].name}`}
            detail={doing(z)}
            meter={z.energy / 100}
            right={<Btn small tone={z.energy < 30 ? 'go' : 'ghost'} label={`☕ ${ESPRESSO_COST}`} onPress={() => run((st) => espresso(st, z.id))} />}
          />
        ))}
        <Text style={styles.note}>Zombies slow to a crawl when they run out of energy; an espresso wakes one right up. Well-fed guests sometimes think about joining: tap one showing “Join?” to recruit them for free.</Text>
      </Sheet>

      {/* ---------------- about, sound, reset */}
      <Sheet open={panel?.kind === 'menu'} onClose={() => setPanel(null)} title="Your diner">
        <Row icon="⭐" title={`${s.rating.toFixed(1)} stars`} detail="Fed guests raise it. Guests who wait too long lower it." />
        <Row icon="🍽️" title={`${num(s.served)} guests served`} detail={`Level ${s.level} · ${num(s.xp)} / ${num(nextXp)} XP`} />
        <Row icon="🧟" title={`${s.recruited} guests recruited`} detail={`${s.staff.length} zombies on staff`} />
        <Row icon="🦇" title={`${spook(s)} spook`} detail={`Tips +${Math.round(tipBonus(s) * 100)}%`} />
        <Row icon={s.muted ? '🔇' : '🔊'} title={s.muted ? 'Sound off' : 'Sound on'} detail="Tap to switch" onPress={() => act((st) => void (st.muted = !st.muted))} />
        <ResetButton
          onReset={() => {
            reset();
            setPanel(null);
            setBuild(null);
          }}
        />
      </Sheet>

      {!s.seenIntro ? <Intro onStart={() => act((st) => void (st.seenIntro = true))} /> : null}
      {s.levelUp ? <LevelUp level={s.levelUp} onClose={() => act((st) => void (st.levelUp = null))} /> : null}
    </View>
  );
}

function doing(z: Staff): string {
  const sleepy = z.energy <= 0 ? ' (half asleep)' : '';
  const t = z.task;
  if (!t || t.type === 'wander') return `Shambling about${sleepy}`;
  if (t.type === 'haul') return `Carrying food to the counter${sleepy}`;
  if (t.type === 'clean') return `Wiping a table${sleepy}`;
  const dish = z.carrying ? dishById(z.carrying.dish).name : 'an order';
  return `Serving ${dish}${sleepy}`;
}

// ---------------------------------------------------------------- small pieces

function GoalBanner({ text, have, need, reward, onClaim }: { text: string; have: number; need: number; reward: number; onClaim: () => void }) {
  const done = have >= need;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!done) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.06, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: native }),
        Animated.timing(pulse, { toValue: 1, duration: 420, easing: Easing.in(Easing.quad), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [done, pulse]);
  return (
    <Pressable onPress={done ? onClaim : undefined} style={styles.goal}>
      <Text style={{ fontSize: 18 }}>{done ? '🎁' : '🎯'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.goalText} numberOfLines={1}>
          {text}
        </Text>
        <View style={[styles.xpTrack, { marginTop: 4 }]}>
          <View style={[styles.xpFill, { backgroundColor: C.zombie, transform: [{ scaleX: Math.max(0.02, have / need) }] }]} />
        </View>
      </View>
      {done ? (
        <Animated.View style={[styles.claim, { transform: [{ scale: pulse }] }]}>
          <Text style={styles.claimText}>Claim {reward} 🪙</Text>
        </Animated.View>
      ) : (
        <Text style={styles.goalCount}>
          {have}/{need}
        </Text>
      )}
    </Pressable>
  );
}

function Pill({ children, onPress }: { children: ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

function BarButton({ icon, label, onPress, badge }: { icon: string; label: string; onPress: () => void; badge?: string }) {
  return (
    <Pressable
      onPress={() => {
        buzz();
        onPress();
      }}
      style={({ pressed }) => [styles.barBtn, pressed && styles.pressed]}
    >
      <Text style={{ fontSize: 26 }}>{icon}</Text>
      <Text style={styles.barLabel}>{label}</Text>
      {badge ? (
        <View style={styles.barBadge}>
          <Text style={styles.barBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Btn({ label, onPress, tone, small }: { label: string; onPress: () => void; tone: 'go' | 'ghost' | 'danger'; small?: boolean }) {
  const bg = tone === 'go' ? C.zombie : tone === 'danger' ? C.danger : C.panel2;
  const fg = tone === 'ghost' ? C.text : '#1a1226';
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.btn, { backgroundColor: bg }, small && styles.btnSmall, pressed && styles.pressed]}>
      <Text style={[styles.btnText, { color: fg }, small && { fontSize: 13 }]}>{label}</Text>
    </Pressable>
  );
}

function Row({ icon, title, detail, right, onPress, dim, meter }: { icon: string; title: string; detail: string; right?: ReactNode; onPress?: () => void; dim?: boolean; meter?: number }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.rowCard, dim && { opacity: 0.5 }, pressed && styles.pressed]}>
      <Text style={{ fontSize: 30 }}>{icon}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
        {meter !== undefined ? (
          <View style={[styles.xpTrack, { marginTop: 4 }]}>
            <View style={[styles.xpFill, { backgroundColor: meter > 0.3 ? C.zombie : meter > 0 ? C.coin : C.danger, transform: [{ scaleX: Math.max(0.03, meter) }] }]} />
          </View>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

function Price({ amount, short, locked }: { amount: number; short?: boolean; locked?: boolean }) {
  return (
    <View style={styles.price}>
      <Text style={[styles.priceText, short && { color: C.danger }]}>{locked ? '🔒' : `${num(amount)} 🪙`}</Text>
    </View>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <View style={styles.seg}>
      {options.map(([v, label]) => (
        <Pressable
          key={v}
          onPress={() => {
            buzz();
            onChange(v);
          }}
          style={[styles.segBtn, v === value && styles.segOn]}
        >
          <Text style={[styles.segText, v === value && { color: '#1a1226' }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function StoveStatus({ dish, left, p, onDiscard }: { dish: Parameters<typeof dishById>[0]; left: number; p: number; onDiscard: () => void }) {
  const d = dishById(dish);
  const [sure, setSure] = useState(false);
  return (
    <View style={{ gap: 12, alignItems: 'center', paddingVertical: 8 }}>
      <Text style={{ fontSize: 56 }}>{d.emoji}</Text>
      <Text style={styles.rowTitle}>{d.name}</Text>
      <View style={[styles.xpTrack, { width: '100%', height: 10, borderRadius: 5 }]}>
        <View style={[styles.xpFill, { backgroundColor: C.coin, transform: [{ scaleX: Math.max(0.02, Math.min(1, p)) }] }]} />
      </View>
      <Text style={styles.muted}>{left > 0 ? `Ready in ${duration(left)}. Your zombies will carry it out.` : 'Ready!'}</Text>
      <Btn tone={sure ? 'danger' : 'ghost'} label={sure ? 'Tap again to throw it out' : 'Throw it out'} onPress={() => (sure ? onDiscard() : setSure(true))} />
    </View>
  );
}

function ResetButton({ onReset }: { onReset: () => void }) {
  const [sure, setSure] = useState(false);
  return <Btn tone={sure ? 'danger' : 'ghost'} label={sure ? 'Tap again: this erases your diner' : 'Start a new diner'} onPress={() => (sure ? onReset() : setSure(true))} />;
}

function Toast({ text, stamp, top }: { text: string | null; stamp: number; top: number }) {
  const t = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (text) setShown(text);
    Animated.timing(t, { toValue: text ? 1 : 0, duration: text ? 220 : 180, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [text, stamp, t]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.toast, { top, opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }] }]}
    >
      <Text style={styles.toastText}>{shown}</Text>
    </Animated.View>
  );
}

function Overlay({ children }: { children: ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(t, { toValue: 1, useNativeDriver: native, bounciness: 8, speed: 14 }).start();
  }, [t]);
  return (
    <View style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Animated.View style={[styles.card, { opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>{children}</Animated.View>
    </View>
  );
}

function Intro({ onStart }: { onStart: () => void }) {
  return (
    <Overlay>
      <Text style={{ fontSize: 56, textAlign: 'center' }}>🌙🧟🍔</Text>
      <Text style={styles.cardTitle}>Night Bite Diner</Text>
      <Text style={styles.cardBody}>You run the only diner in town that opens after midnight. Your staff are zombies: hard-working, a little slow, and powered by espresso.</Text>
      <View style={{ gap: 8, alignSelf: 'stretch' }}>
        <Step n="1" text="Tap the stove and pick something to cook." />
        <Step n="2" text="Zombies carry food to the counter, serve guests and wipe tables." />
        <Step n="3" text="Feed guests before they lose patience. A happy guest may ask to join: tap “Join?” to recruit them." />
        <Step n="4" text="Buy furniture and spooky decor, expand the room, follow the goals." />
      </View>
      <Text style={[styles.cardBody, { fontSize: 13 }]}>Drag to look around. Pinch or use + and − to zoom.</Text>
      <Btn tone="go" label="Open the diner" onPress={onStart} />
    </Overlay>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <Text style={[styles.cardBody, { flex: 1, textAlign: 'left' }]}>{text}</Text>
    </View>
  );
}

function LevelUp({ level, onClose }: { level: number; onClose: () => void }) {
  useEffect(() => buzz('win'), []);
  const dishes = DISHES.filter((d) => d.level === level).map((d) => `${d.emoji} ${d.name}`);
  const decor = (Object.keys(ITEMS) as ItemKind[]).filter((k) => ITEMS[k].level === level).map((k) => `${ITEMS[k].emoji} ${ITEMS[k].name}`);
  const more: string[] = [];
  for (const k of ['stove', 'counter', 'table'] as ItemKind[]) if (maxOf(k, level) > maxOf(k, level - 1)) more.push(`another ${ITEMS[k].name.toLowerCase()}`);
  if (maxStaff(level) > maxStaff(level - 1)) more.push('another zombie');
  const rooms = ROOMS.filter((r) => r.level === level).map((r) => `🧱 Expand to ${r.size} × ${r.size}`);
  const unlocks = [...dishes, ...decor, ...rooms, ...more.map((m) => `Room for ${m}`)];
  return (
    <Overlay>
      <Text style={{ fontSize: 56, textAlign: 'center' }}>🎉</Text>
      <Text style={styles.cardTitle}>Level {level}!</Text>
      <Text style={styles.cardBody}>+{50 * level} 🪙 bonus</Text>
      {unlocks.length ? (
        <View style={{ gap: 4 }}>
          {unlocks.map((u) => (
            <Text key={u} style={[styles.cardBody, { color: C.zombie }]}>
              {u}
            </Text>
          ))}
        </View>
      ) : null}
      <Btn tone="go" label="Back to work" onPress={onClose} />
    </Overlay>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  muted: { color: C.muted, fontSize: 15, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },

  hud: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.panel, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.line },
  pillIcon: { fontSize: 16 },
  pillText: { color: C.text, fontWeight: '800', fontSize: 16, fontVariant: ['tabular-nums'] },
  level: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.panel, borderRadius: 999, padding: 4, paddingRight: 12, borderWidth: 1, borderColor: C.line },
  levelBadge: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  levelText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  levelLabel: { color: C.text, fontSize: 12, fontWeight: '800', marginBottom: 3 },
  xpTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  xpFill: { width: '100%', height: '100%', backgroundColor: C.purple, transformOrigin: 'left' },

  goal: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line },
  goalText: { color: C.text, fontSize: 13, fontWeight: '700' },
  goalCount: { color: C.muted, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  claim: { backgroundColor: C.zombie, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  claimText: { color: '#1a1226', fontWeight: '900', fontSize: 13 },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, paddingHorizontal: 12, backgroundColor: C.panel, borderTopWidth: 1, borderColor: C.line },
  barBtn: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 14, gap: 2 },
  barLabel: { color: C.text, fontSize: 12, fontWeight: '700' },
  barBadge: { position: 'absolute', top: 2, right: '24%', backgroundColor: C.danger, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  barBadgeText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  buildBar: { gap: 10 },
  buildHint: { color: C.text, fontSize: 14, textAlign: 'center' },

  btn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  btnText: { fontWeight: '800', fontSize: 15 },

  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel2, borderRadius: 16, padding: 12 },
  rowTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  rowDetail: { color: C.muted, fontSize: 13 },
  price: { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  priceText: { color: C.coin, fontWeight: '800', fontSize: 14 },
  note: { color: C.muted, fontSize: 13, lineHeight: 18, paddingVertical: 4 },

  seg: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 3, marginBottom: 4 },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  segOn: { backgroundColor: C.zombie },
  segText: { color: C.muted, fontWeight: '800', fontSize: 13 },

  toast: { position: 'absolute', alignSelf: 'center', maxWidth: '88%', backgroundColor: '#f3ecff', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  toastText: { color: '#1a1226', fontWeight: '700', fontSize: 14, textAlign: 'center' },

  scrim: { backgroundColor: 'rgba(5,2,12,0.75)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, backgroundColor: C.panel, borderRadius: 24, padding: 22, gap: 14, borderWidth: 1, borderColor: C.line, alignItems: 'center' },
  cardTitle: { color: C.text, fontSize: 26, fontWeight: '900', textAlign: 'center' },
  cardBody: { color: C.muted, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.zombie, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  stepNumText: { color: '#1a1226', fontWeight: '900', fontSize: 13 },
});
