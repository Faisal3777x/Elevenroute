import {
  Check, Clock, Feather, Layers, LoaderCircle, RotateCcw, TriangleExclamationPoint, X, type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

import type { TurnType, VendorState } from '../../../shared/types';
import { signed } from '../lib/format';
import { useIndicator } from '../lib/indicator';
import { fast, spring } from '../lib/motion';

/** True once `flag` has stayed true for `ms`; false again at once. Keeps quick operations from flashing a spinner. */
function useDelayed(flag: boolean, ms: number) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!flag) return setLate(false);
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return flag && late;
}

// ---------- layout ----------
export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
        <h1 className="h-display text-[34px] leading-[1.1] tracking-[-0.025em] sm:text-[42px]">{title}</h1>
        {subtitle ? <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * Page body. Its sections rise in as one quick wave when the page opens (`.page-enter` in index.css, compositor-only),
 * and content that arrives later rises in the same way. Mark a grid `cascade` to bring its cards in one by one.
 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="page-enter mx-auto flex w-full max-w-[1200px] flex-col gap-5">{children}</div>;
}

export function Card({ title, subtitle, right, children, className = '', id }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`card p-5 sm:p-6 ${className}`}>
      {title || right ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="h-display text-[21px] leading-tight">{title}</h2> : null}
            {subtitle ? <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{subtitle}</p> : null}
          </div>
          {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ---------- controls ----------
type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  loading?: boolean;
};

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, children, className = '', disabled, ...props }: ButtonProps) {
  const slow = useDelayed(Boolean(loading), 200);
  const styles = {
    primary: 'bg-ink text-white hover:bg-ink/90 shadow-[0_1px_2px_rgb(0_0_0/0.1)]',
    secondary: 'bg-canvas text-ink border border-line hover:border-ink/20 hover:bg-white',
    ghost: 'text-ink-2 hover:text-ink hover:bg-card',
  }[variant];
  const sizing = size === 'sm' ? 'h-9 px-3.5 text-[13px] gap-1.5' : 'h-11 px-5 text-[15px] gap-2';
  return (
    <motion.button
      type="button"
      whileTap={disabled || loading ? undefined : { scale: 0.97 }}
      transition={spring}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`group inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-colors ${loading ? 'cursor-progress' : 'disabled:cursor-not-allowed disabled:opacity-45'} ${styles} ${sizing} ${className}`}
      {...props}>
      {slow ? <LoaderCircle size={size === 'sm' ? 14 : 16} className="animate-spin" aria-hidden="true" /> : Icon ? <Icon size={size === 'sm' ? 14 : 16} aria-hidden="true" className="transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-rotate-6 group-hover:scale-110 group-disabled:rotate-0 group-disabled:scale-100" /> : null}
      {children}
    </motion.button>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, size = 'md', label }: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label: string;
}) {
  // The white pill slides to the chosen option on the compositor (see useIndicator).
  const [group, pill] = useIndicator<HTMLDivElement>('[aria-checked="true"]', [value, options.length]);
  return (
    <div ref={group} role="radiogroup" aria-label={label} className="relative inline-flex w-fit max-w-full flex-wrap rounded-full bg-line/80 p-[3px]">
      <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 rounded-full bg-canvas shadow-[0_1px_3px_rgb(0_0_0/0.08)]" style={pill} />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`press relative rounded-full font-medium transition-colors ${size === 'sm' ? 'px-3 py-1.5 text-[12.5px]' : 'px-4 py-2 text-[13.5px]'} ${active ? 'text-ink' : 'text-ink-2 hover:text-ink'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({ active, onClick, children, className = '' }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      whileTap={{ scale: 0.96 }}
      transition={spring}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active ? 'border-ink bg-ink text-white' : 'border-line bg-canvas text-ink hover:border-ink/25'
      } ${className}`}>
      {children}
    </motion.button>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex items-start gap-3 rounded-xl text-left">
      <span className={`relative mt-0.5 inline-flex h-6 w-10 shrink-0 rounded-full p-[3px] transition-colors ${checked ? 'bg-ink' : 'bg-line'}`}>
        <motion.span initial={false} animate={{ x: checked ? 16 : 0 }} transition={spring} className="h-[18px] w-[18px] rounded-full bg-white shadow" />
      </span>
      <span>
        <span className="block text-[14.5px] text-ink">{label}</span>
        {description ? <span className="block text-[12.5px] text-ink-3">{description}</span> : null}
      </span>
    </button>
  );
}

export function Field({ label, hint, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      {label ? <span className="label">{label}</span> : null}
      <input id={id} {...props} className="h-11 rounded-2xl border border-line bg-canvas px-3.5 text-[15px] text-ink placeholder:text-ink-3 transition-colors focus:border-ink/30 focus:outline-none" />
      {hint ? <span className="text-[12px] text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function TextArea({ label, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      {label ? <span className="label">{label}</span> : null}
      <textarea id={id} {...props} className="min-h-[84px] rounded-2xl border border-line bg-canvas px-3.5 py-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-ink/30 focus:outline-none" />
    </label>
  );
}

// ---------- status ----------
const STATUS: Record<VendorState | 'ok' | 'fail' | 'excluded' | 'warn', { icon: LucideIcon; label: string; cls: string }> = {
  healthy: { icon: Check, label: 'Healthy', cls: 'text-ok border-ok/30' },
  ok: { icon: Check, label: 'OK', cls: 'text-ok border-ok/30' },
  down: { icon: X, label: 'Down', cls: 'text-bad border-bad/30' },
  fail: { icon: X, label: 'Failed', cls: 'text-bad border-bad/30' },
  slow: { icon: Clock, label: 'Slow', cls: 'text-warn border-warn/35' },
  warn: { icon: TriangleExclamationPoint, label: 'Warning', cls: 'text-warn border-warn/35' },
  excluded: { icon: TriangleExclamationPoint, label: 'Excluded', cls: 'text-bad border-bad/30' },
};

/** Status is always colour + icon + label, never colour alone. Animates when it changes. */
export function Status({ kind, label }: { kind: keyof typeof STATUS; label?: string }) {
  const s = STATUS[kind];
  const Icon = s.icon;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={`${kind}-${label ?? ''}`}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
        transition={fast}
        className={`inline-flex items-center gap-1 rounded-full border bg-canvas px-2.5 py-[3px] text-[12px] font-medium whitespace-nowrap ${s.cls}`}>
        <Icon size={12} strokeWidth={2.6} aria-hidden="true" />
        {label ?? s.label}
      </motion.span>
    </AnimatePresence>
  );
}

/** Simple vs complex classification: violet feather vs ember layers. */
export function TurnBadge({ turnType, score }: { turnType: TurnType; score?: number }) {
  const simple = turnType === 'simple';
  const Icon = simple ? Feather : Layers;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-[3px] text-[12px] font-medium ${simple ? 'bg-violet/8 text-violet' : 'bg-ember/10 text-[#c2410c]'}`}>
      <Icon size={12} aria-hidden="true" />
      {simple ? 'Simple' : 'Complex'}
      {score !== undefined ? <span className="opacity-70">· score {signed(score)}</span> : null}
    </span>
  );
}

// ---------- feedback ----------
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-[20px] border border-bad/25 bg-bad/[0.04] p-4">
      <TriangleExclamationPoint size={18} className="mt-0.5 text-bad" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-medium text-ink">{error}</p>
      </div>
      {onRetry ? <Button size="sm" variant="secondary" icon={RotateCcw} onClick={onRetry}>Retry</Button> : null}
    </div>
  );
}

export function Empty({ title, body, action, visual }: { title: string; body: string; action?: ReactNode; visual?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-12 text-center">
      {visual ? <div className="mb-5">{visual}</div> : null}
      <h2 className="h-display text-2xl">{title}</h2>
      <p className="max-w-md text-[14px] leading-relaxed text-ink-3">{body}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </Card>
  );
}
