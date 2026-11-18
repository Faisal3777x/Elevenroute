/**
 * A short numbered "how it works" row under a page header. The landing page links here instead of explaining it,
 * so each page carries the explanation of what it shows.
 */
export function HowItWorks({ label, steps }: { label: string; steps: { title: string; body: string }[] }) {
  return (
    <section aria-label={label}>
      <ol className={`grid gap-x-8 gap-y-5 sm:grid-cols-2 ${steps.length === 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3'}`}>
        {steps.map((s, i) => (
          <li key={s.title} className="border-t border-ink/12 pt-3">
            <span className="font-mono text-[11.5px] tracking-[0.08em] text-ink-3">{String(i + 1).padStart(2, '0')}</span>
            <h2 className="mt-1.5 text-[14.5px] font-medium text-ink">{s.title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-pretty text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
