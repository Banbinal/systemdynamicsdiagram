const SKILL_FILES = [
  'skill/SKILL.md',
  'skill/references/grammar.md',
  'skill/references/patterns.md',
  'skill/references/examples.md',
] as const;

let cached: Promise<string> | null = null;

/**
 * Fetches SKILL.md plus the three reference files from /public/skill/ and
 * concatenates them into a single string suitable for use as model context.
 *
 * Cached after first success. On failure the cache is cleared so the user
 * can retry.
 */
export function loadSkillContext(): Promise<string> {
  if (cached) return cached;
  const base = import.meta.env.BASE_URL;
  const p = Promise.all(
    SKILL_FILES.map(async (rel) => {
      const res = await fetch(`${base}${rel}`);
      if (!res.ok) {
        throw new Error(`Failed to load ${rel}: HTTP ${res.status}`);
      }
      const body = await res.text();
      return `=== ${rel} ===\n${body}`;
    }),
  ).then((parts) => parts.join('\n\n'));
  cached = p;
  p.catch(() => {
    if (cached === p) cached = null;
  });
  return p;
}
