import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { C, F, S } from '@/constants/theme';
import { ms, money } from '@/lib/format';

import type { RouteTrace } from '../../../shared/types';
import { Icon } from './icon';
import { Body, Label, Mono, Muted, Row } from './ui';

/** Route trace: classifier rules, policy, ranked candidates, attempts. */
export function Trace({ trace, initiallyOpen = false }: { trace: RouteTrace; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const c = trace.classification;
  return (
    <View>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ paddingVertical: 4 }}>
        <Row gap={6}>
          <Icon name={open ? 'down' : 'right'} size={14} color={C.ink2} />
          <Label>Route trace</Label>
        </Row>
      </Pressable>
      {open && (
        <View style={{ gap: S.md, marginTop: S.sm }}>
          <View style={{ gap: 4 }}>
            <Label>Classifier · score {c.score} → {c.turnType}</Label>
            {c.hits.length === 0 ? <Mono>no rules fired</Mono> : c.hits.map((h, i) => (
              <Mono key={i}>{h.weight > 0 ? '+' : ''}{h.weight}  {h.label}</Mono>
            ))}
          </View>
          <View style={{ gap: 4 }}>
            <Label>Policy</Label>
            <Mono>{trace.policy} · quality floor {trace.qualityFloor.toFixed(2)}{trace.sticky ? ' · sticky' : ''}</Mono>
          </View>
          <View style={{ gap: 4 }}>
            <Label>Candidates</Label>
            {[...trace.candidates].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((cand) => (
              <Mono key={cand.modelId} style={!cand.eligible ? { color: C.ink3, textDecorationLine: 'line-through' } : undefined}>
                {cand.rank ? `#${cand.rank}` : ' — '} {cand.name} · q {cand.quality.toFixed(2)} · {money(cand.cost)}/1k{cand.note ? ` · ${cand.note}` : ''}
              </Mono>
            ))}
          </View>
          {trace.attempts.length > 0 && (
            <View style={{ gap: 4 }}>
              <Label>Attempts</Label>
              {trace.attempts.map((a, i) => (
                <Mono key={i} style={{ color: a.ok ? C.ok : C.bad }}>
                  {a.ok ? '✓' : '✕'} {a.modelId} · {ms(a.latencyMs)}{a.error ? ` · ${a.error}` : ''}
                </Mono>
              ))}
            </View>
          )}
          <Muted>Routing overhead {ms(trace.overheadMs)} (excludes the model call)</Muted>
        </View>
      )}
    </View>
  );
}

export function ReasonText({ text }: { text: string }) {
  return <Body style={{ fontFamily: F.regular, fontSize: 13, color: C.ink2, lineHeight: 19 }}>{text}</Body>;
}
