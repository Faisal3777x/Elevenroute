import { type ReactNode, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { C, F, S } from '@/constants/theme';
import { money, shortDate } from '@/lib/format';

import { Label, Muted, Row } from './ui';

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <Row wrap gap={S.md} style={{ marginTop: S.md }}>
      {items.map((i) => (
        <Row key={i.label} gap={6}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: i.color }} />
          <Muted style={{ color: C.ink2 }}>{i.label}</Muted>
        </Row>
      ))}
    </Row>
  );
}

/** Stacked daily bars (cost per model over time). */
export function StackedBars({ days, series, height = 180, format = money }: { days: string[]; series: Series[]; height?: number; format?: (n: number) => string }) {
  const [width, setWidth] = useState(0);
  const totals = days.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = Math.max(...totals, 0) || 1;
  const left = 4;
  const bottom = 18;
  const plotH = height - bottom - 14;
  const slot = width > 0 ? (width - left) / days.length : 0;
  const barW = Math.max(3, Math.min(28, slot * 0.62));
  const every = Math.ceil(days.length / Math.max(1, Math.floor(width / 48)));

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityLabel={`Bar chart, peak ${format(max)} per day`}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <SvgText x={left} y={10} fontSize={10} fill={C.ink3} fontFamily={F.regular}>{format(max)}</SvgText>
          <Line x1={left} x2={width} y1={14} y2={14} stroke={C.line} strokeDasharray="3 4" />
          <Line x1={left} x2={width} y1={14 + plotH} y2={14 + plotH} stroke={C.line} />
          {days.map((d, i) => {
            let y = 14 + plotH;
            const x = left + i * slot + (slot - barW) / 2;
            return (
              <G key={d}>
                {series.map((s) => {
                  const h = ((s.values[i] ?? 0) / max) * plotH;
                  y -= h;
                  return h > 0 ? <Rect key={s.key} x={x} y={y} width={barW} height={Math.max(h - 1, 0.5)} fill={s.color} rx={2} /> : null;
                })}
                {i % every === 0 && (
                  <SvgText x={x + barW / 2} y={height - 4} fontSize={10} fill={C.ink3} textAnchor="middle" fontFamily={F.regular}>
                    {shortDate(d)}
                  </SvgText>
                )}
              </G>
            );
          })}
        </Svg>
      )}
    </View>
  );
}

/** Accessible table view of the same data. */
export function SeriesTable({ days, series, format = money }: { days: string[]; series: Series[]; format?: (n: number) => string }) {
  const cell = { width: 86, paddingVertical: 6, paddingHorizontal: 4 } as const;
  return (
    <ScrollView horizontal>
      <View>
        <Row gap={0} style={{ borderBottomWidth: 1, borderColor: C.line }}>
          <Label style={{ ...cell, width: 64 }}>Day</Label>
          {series.map((s) => <Label key={s.key} style={cell} numberOfLines={1}>{s.label}</Label>)}
        </Row>
        {days.map((d, i) => (
          <Row key={d} gap={0} style={{ borderBottomWidth: 1, borderColor: C.line }}>
            <Text style={{ ...cell, width: 64, fontFamily: F.regular, fontSize: 12, color: C.ink2 }}>{shortDate(d)}</Text>
            {series.map((s) => (
              <Text key={s.key} style={{ ...cell, fontFamily: F.mono, fontSize: 12, color: C.ink }}>{format(s.values[i] ?? 0)}</Text>
            ))}
          </Row>
        ))}
      </View>
    </ScrollView>
  );
}

/** Horizontal split bars: one row per item with two segments. */
export function SplitBars({ rows, labels }: {
  rows: { key: string; label: string; color: string; a: number; b: number; lead?: ReactNode }[];
  labels: [string, string];
}) {
  const max = Math.max(...rows.map((r) => r.a + r.b), 1);
  return (
    <View style={{ gap: S.md }}>
      {rows.map((r) => (
        <View key={r.key} style={{ gap: 6 }} accessibilityLabel={`${r.label}: ${r.a} ${labels[0]}, ${r.b} ${labels[1]}`}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Row gap={S.sm} style={{ flexShrink: 1 }}>
              {r.lead}
              <Text style={{ fontFamily: F.medium, fontSize: 14, color: C.ink }} numberOfLines={1}>{r.label}</Text>
            </Row>
            <Muted>{r.a.toLocaleString()} {labels[0]} · {r.b.toLocaleString()} {labels[1]}</Muted>
          </Row>
          <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, backgroundColor: C.line, overflow: 'hidden' }}>
            <View style={{ width: `${(r.a / max) * 100}%`, backgroundColor: r.color }} />
            <View style={{ width: `${(r.b / max) * 100}%`, backgroundColor: r.color, opacity: 0.45 }} />
          </View>
        </View>
      ))}
      <Row gap={S.md}>
        <Row gap={6}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: C.ink2 }} /><Muted>{labels[0]}</Muted></Row>
        <Row gap={6}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: C.ink2, opacity: 0.45 }} /><Muted>{labels[1]}</Muted></Row>
      </Row>
    </View>
  );
}

/** Score bar against a floor marker (test results). */
export function ScoreBar({ value, floor, color }: { value: number; floor: number; color: string }) {
  return (
    <View style={{ height: 10, borderRadius: 5, backgroundColor: C.line, overflow: 'visible', justifyContent: 'center' }}>
      <View style={{ width: `${Math.min(100, value * 100)}%`, height: 10, borderRadius: 5, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: `${floor * 100}%`, width: 2, height: 18, backgroundColor: C.ink, borderRadius: 1 }} />
    </View>
  );
}
