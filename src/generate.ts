import { runAs } from './ai/provider.ts';
import {
  FACTS_SCHEMA,
  VERDICTS_SCHEMA,
  generatePrompt,
  shortenPrompt,
  verifyPrompt,
  type GeneratedFact,
  type Verdict,
} from './ai/prompt.ts';
import { checkSources, contentIssues, findDuplicate, isTooLong, type KnownFact } from './checks.ts';
import { openDraftsAsKnown, type CheckedDraft, type PreparedDraft } from './drafts.ts';
import { getKnownFacts, getTopics } from './supabase.ts';

/** Ein Entwurf nach der Code-Prüfung. `blocked`: harter Fehler, der Fact wird gar nicht erst geprüft. */
type Candidate = PreparedDraft & { blocked: boolean };

async function askForFacts(prompt: string): Promise<GeneratedFact[]> {
  const result = (await runAs('writer', prompt, FACTS_SCHEMA)) as { facts?: GeneratedFact[] };
  return result.facts ?? [];
}

async function topicName(topicId: string): Promise<string> {
  const topic = (await getTopics()).find((t) => t.id === topicId);
  return topic?.name ?? topicId;
}

/** Alle Facts, die schon existieren (Supabase + offene Entwürfe). */
async function knownFacts(exceptDraftId?: number): Promise<KnownFact[]> {
  return [...(await getKnownFacts()), ...openDraftsAsKnown(exceptDraftId)];
}

/** Kürzt zu lange Facts (optional) mit einem Nachauftrag und prüft dann alles automatisch. */
async function prepare(
  topicId: string,
  facts: GeneratedFact[],
  known: KnownFact[],
  { shorten = true } = {},
): Promise<Candidate[]> {
  const tooLong = shorten ? facts.filter(isTooLong) : [];
  if (tooLong.length) {
    const shortened = await askForFacts(shortenPrompt(tooLong));
    tooLong.forEach((fact, index) => {
      if (shortened[index]) Object.assign(fact, shortened[index]);
    });
  }

  const prepared: Candidate[] = [];
  for (const fact of facts) {
    const sources = await checkSources(fact.sources);
    const issues = contentIssues(fact);
    const duplicate = findDuplicate(fact, [...known, ...prepared]);
    if (duplicate) issues.push(`Mögliche Dublette von „${duplicate}“`);
    const blocked = issues.length > 0;
    // Nicht erreichbare Quellen sind kein harter Fehler: manche Seiten sperren automatische Aufrufe.
    for (const source of sources) {
      if (!source.ok) issues.push(`Quelle nicht erreichbar: ${source.title}`);
    }
    prepared.push({ topic_id: topicId, ...fact, sources, issues, blocked });
  }
  return prepared;
}

/** Lässt die zweite KI alle Facts in einem Auftrag prüfen. */
async function verify(candidates: Candidate[]): Promise<Verdict[]> {
  const facts = candidates.map(({ title, summary, body, sources, issues }) => ({
    title,
    summary,
    body,
    sources: sources.map(({ title, url }) => ({ title, url })),
    notes: issues,
  }));
  const result = (await runAs('checker', verifyPrompt(facts), VERDICTS_SCHEMA)) as { verdicts?: Verdict[] };
  return result.verdicts ?? [];
}

export type GenerateResult = { passed: CheckedDraft[]; rejected: number };

/** Erzeugt bis zu `count` Facts zu einem Thema. Zurück kommen nur die, die beide Prüfungen bestanden haben. */
export async function generateDrafts(topicId: string, count: number): Promise<GenerateResult> {
  const known = await knownFacts();
  const facts = await askForFacts(generatePrompt({
    topicName: await topicName(topicId),
    count,
    existingTitles: known.map((fact) => fact.title),
  }));
  if (!facts.length) throw new Error('Die KI hat keine Facts geliefert.');

  const prepared = await prepare(topicId, facts.slice(0, count), known);
  const candidates = prepared.filter((fact) => !fact.blocked);
  const verdicts = candidates.length ? await verify(candidates) : [];

  const passed: CheckedDraft[] = [];
  candidates.forEach(({ blocked, ...draft }, index) => {
    const verdict = verdicts[index];
    if (verdict?.ok) passed.push({ ...draft, review: verdict.reason });
    else console.log(`Verworfen: „${draft.title}“ – ${verdict?.reason ?? 'kein Urteil'}`);
  });
  return { passed, rejected: prepared.length - passed.length };
}

/** Prüft einen von Hand bearbeiteten Entwurf erneut, ohne dass eine KI etwas ändert. */
export async function recheckDraft(draftId: number, edited: GeneratedFact & { topic_id: string }): Promise<PreparedDraft> {
  const { topic_id, ...fact } = edited;
  const [{ blocked, ...prepared }] = await prepare(topic_id, [fact], await knownFacts(draftId), { shorten: false });
  return prepared;
}
