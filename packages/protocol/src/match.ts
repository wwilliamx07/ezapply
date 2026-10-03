/**
 * Strict option matching, shared by the site adapters (a fill sent with `strict: true`) and the companion's
 * autofill planner, so both mean the same thing by "the option the value names". No imports: the adapters are
 * bundled into application pages and stay small.
 *
 * Strict accepts, case, spacing, Unicode width and curly apostrophes aside:
 * - the option itself;
 * - the option without its trailing parenthetical, or the parenthetical alone ("Python" → "Python (Programming
 *   Language)", "SQL" → "Structured Query Language (SQL)", "Canada" → "Canada (+1)");
 * - the option without a leading rank ("Fluent" → "5 - Fluent", seen live on Workday's language levels).
 *
 * It never accepts a prefix or a substring, which the adapters' loose `matchOption` does: "Yes" picking "Yes, I
 * will require sponsorship" is fine for the model, which reads the read-back, not for a fill nobody checks field
 * by field.
 */

/** Text as options are compared: NFKC, lowercase, straight apostrophes, single spaces. */
export function normOption(s: string): string {
  return s.normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The forms of an option that a strict match accepts, normalised. */
function optionForms(option: string): string[] {
  const o = normOption(option);
  const out = [o];
  const bare = o.replace(/\s*\([^)]*\)$/, "");
  if (bare !== o && bare) out.push(bare);
  const paren = /\(([^)]*)\)$/.exec(o)?.[1]?.trim();
  if (paren) out.push(paren);
  const unranked = o.replace(/^\d+\s*[-–.):]\s*/, "");
  if (unranked !== o && unranked) out.push(unranked);
  return out;
}

export function strictMatch(wanted: string, option: string): boolean {
  const w = normOption(wanted);
  return Boolean(w) && optionForms(option).includes(w);
}

/** The first option `wanted` names strictly, or -1. */
export function strictIndex(wanted: string, options: readonly string[]): number {
  return options.findIndex((o) => strictMatch(wanted, o));
}
