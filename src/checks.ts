import { MAX_SUMMARY, MAX_TITLE, type GeneratedFact, type Source } from './ai/prompt.ts';

export type CheckedSource = Source & { ok: boolean; status?: number };
export type KnownFact = { title: string; summary: string };

export function isTooLong(fact: Pick<GeneratedFact, 'title' | 'summary'>): boolean {
  return fact.title.length > MAX_TITLE || fact.summary.length > MAX_SUMMARY;
}

/** Hinweise zu Länge und Vollständigkeit. Leer heißt: alles in Ordnung. */
export function contentIssues(fact: GeneratedFact): string[] {
  const issues: string[] = [];
  if (fact.title.length > MAX_TITLE) issues.push(`Titel zu lang (${fact.title.length}/${MAX_TITLE})`);
  if (fact.summary.length > MAX_SUMMARY) issues.push(`Summary zu lang (${fact.summary.length}/${MAX_SUMMARY})`);
  if (!fact.body.trim()) issues.push('Text fehlt');
  if (!fact.sources.length) issues.push('Keine Quelle');
  return issues;
}

/** Ruft jede Quelle auf. Manche Seiten sperren automatische Aufrufe – rot heißt also „selbst prüfen“. */
export function checkSources(sources: Source[]): Promise<CheckedSource[]> {
  return Promise.all(
    sources.map(async (source) => {
      if (!/^https?:\/\//.test(source.url)) return { ...source, ok: false };
      try {
        const response = await fetch(source.url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(10_000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NuggetStudio/1.0)' },
        });
        await response.body?.cancel();
        return { ...source, ok: response.ok, status: response.status };
      } catch {
        return { ...source, ok: false };
      }
    }),
  );
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
}

/** Anteil gemeinsamer Wörter (0 bis 1). */
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Titel des ähnlichsten bekannten Facts, falls er verdächtig ähnlich ist. */
export function findDuplicate(fact: KnownFact, known: KnownFact[]): string | undefined {
  const own = words(`${fact.title} ${fact.summary}`);
  let best: { title: string; score: number } | undefined;
  for (const other of known) {
    const score = similarity(own, words(`${other.title} ${other.summary}`));
    if (score > (best?.score ?? 0)) best = { title: other.title, score };
  }
  return best && best.score >= 0.35 ? best.title : undefined;
}
