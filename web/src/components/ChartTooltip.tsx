type Entry = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };

/** Styled Recharts tooltip with accurate, formatted values. */
export function ChartTooltip({ active, payload, label, format, labelFormat, total }: {
  active?: boolean;
  payload?: Entry[];
  label?: string | number;
  format: (n: number) => string;
  labelFormat?: (l: string) => string;
  total?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) > 0);
  const sum = rows.reduce((s, p) => s + Number(p.value), 0);
  return (
    <div className="min-w-[180px] rounded-2xl border border-line bg-canvas/95 px-3.5 py-3 text-[12.5px] shadow-[var(--shadow-float)] backdrop-blur">
      {label !== undefined ? <div className="mb-1.5 font-medium text-ink">{labelFormat ? labelFormat(String(label)) : label}</div> : null}
      <div className="flex flex-col gap-1">
        {rows.map((p) => (
          <div key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-mono text-ink tabular-nums">{format(Number(p.value))}</span>
          </div>
        ))}
        {total && rows.length > 1 ? (
          <div className="mt-1 flex justify-between border-t border-line pt-1.5 font-medium">
            <span>Total</span>
            <span className="font-mono tabular-nums">{format(sum)}</span>
          </div>
        ) : null}
        {rows.length === 0 ? <span className="text-ink-3">No data</span> : null}
      </div>
    </div>
  );
}

/** Legend that doubles as a series filter. */
export function SeriesFilter({ items, hidden, onToggle }: { items: { key: string; label: string; color: string }[]; hidden: Set<string>; onToggle: (key: string) => void }) {
  return (
    <div className="mt-4 flex flex-wrap gap-x-1 gap-y-1.5" role="group" aria-label="Show or hide series">
      {items.map((i) => {
        const off = hidden.has(i.key);
        return (
          <button
            key={i.key}
            type="button"
            aria-pressed={!off}
            onClick={() => onToggle(i.key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] transition-opacity hover:bg-card ${off ? 'opacity-45' : ''}`}>
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: off ? 'transparent' : i.color, border: `1.5px solid ${i.color}` }} />
            <span className={off ? 'text-ink-3 line-through' : 'text-ink-2'}>{i.label}</span>
          </button>
        );
      })}
    </div>
  );
}
