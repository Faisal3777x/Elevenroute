import type { Classification, ClassifierRule, RuleHit, UseCase } from '../../shared/types.ts';

const ARABIC = /[؀-ۿ]/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Latin phrases match on word boundaries. Arabic phrases match inside words,
 * because Arabic attaches prefixes such as "ال" and "و" to the word.
 */
function matches(text: string, phrase: string): boolean {
  const p = phrase.toLowerCase();
  if (ARABIC.test(p)) return text.includes(p);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escape(p)}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

const ENTITY = [
  /(^|\D)[0-9٠-٩]{4,}(\D|$)/, // order / booking numbers
  /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i, // 3pm, 10:30 am
  /\b\d{1,2}:\d{2}\b/,
  /\b(tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|mañana|hoy|lunes|martes|miércoles|jueves|viernes)\b/i,
  /(غدا|غداً|اليوم|الساعة)/,
];

export function classify(message: string, useCase: UseCase, rules: ClassifierRule[], threshold: number): Classification {
  const text = message.trim().toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  const hits: RuleHit[] = [];
  const hit = (r: ClassifierRule, weight = r.weight, label = r.label) => hits.push({ id: r.id, label, weight });

  for (const r of rules) {
    if (!r.enabled) continue;
    switch (r.kind) {
      case 'long':
        if (words > (r.words ?? 18)) hit(r, r.weight, `${r.label} (${words} words)`);
        break;
      case 'short':
        if (words <= (r.words ?? 6)) hit(r, r.weight, `${r.label} (${words} words)`);
        break;
      case 'multistep': {
        const sentences = text.split(/[.!?؟]+/).filter((s) => s.trim().length > 0).length;
        const questions = (text.match(/[?؟]/g) ?? []).length;
        if (sentences >= 3) hit(r, r.weight, `${sentences} sentences`);
        if (questions >= 2) hit(r, r.weight, `${questions} questions`);
        break;
      }
      case 'keywords': {
        const found = (r.phrases ?? []).filter((p) => matches(text, p));
        if (found.length) hit(r, r.weight, `${r.label}: "${found[0]}"`);
        break;
      }
      case 'confirmation': {
        if (words > 10) break;
        const found = (r.phrases ?? []).find((p) => matches(text, p));
        if (found) hit(r, r.weight, `${r.label}: "${found}"`);
        break;
      }
      case 'entity':
        if (ENTITY.some((re) => re.test(text))) hit(r);
        break;
      case 'calltype':
        if (r.useCases?.includes(useCase)) hit(r, r.weight, `${r.label} (${useCase})`);
        break;
    }
  }

  const score = hits.reduce((s, h) => s + h.weight, 0);
  return { turnType: score >= threshold ? 'complex' : 'simple', score, hits };
}
