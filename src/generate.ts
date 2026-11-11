import { runAs, type RunOptions } from './ai/provider.ts';
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
export type Candidate = PreparedDraft & { blocked: boolean };

async function askForFacts(prompt: string, options?: RunOptions): Promise<GeneratedFact[]> {
  const result = (await runAs('writer', prompt, FACTS_SCHEMA, options)) as { facts?: GeneratedFact[] };
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

/**
 * Kürzt zu lange Facts (optional), ruft alle Quellen auf und prüft dann alles automatisch.
 * Quellen ohne gültigen oder mit nicht erreichbarem Link werden entfernt.
 */
async function prepare(
  topicId: string,
  facts: GeneratedFact[],
  known: KnownFact[],
  { shorten = true } = {},
): Promise<Candidate[]> {
  const tooLong = shorten ? facts.filter(isTooLong) : [];
  if (tooLong.length) {
    // Reine Textarbeit: ohne Webrecherche und mit wenig Nachdenken geht es deutlich schneller.
    const shortened = await askForFacts(shortenPrompt(tooLong), { research: false, effort: 'low' });
    tooLong.forEach((fact, index) => {
      if (shortened[index]) Object.assign(fact, shortened[index]);
    });
  }

  // Alle Quellen aller Facts gleichzeitig aufrufen.
  const checkedSources = await Promise.all(facts.map((fact) => checkSources(fact.sources)));

  const prepared: Candidate[] = [];
  facts.forEach((fact, index) => {
    const sources = checkedSources[index].filter((source) => source.ok);
    const removed = checkedSources[index].filter((source) => !source.ok);
    const issues = contentIssues({ ...fact, sources });
    const duplicate = findDuplicate(fact, [...known, ...prepared]);
    if (duplicate) issues.push(`Mögliche Dublette von „${duplicate}“`);
    const blocked = issues.length > 0;
    for (const source of removed) {
      issues.push(`Quelle entfernt (nicht erreichbar): ${source.title || source.url || 'ohne Namen'}`);
    }
    prepared.push({ topic_id: topicId, ...fact, sources, issues, blocked });
  });
  return prepared;
}

/**
 * Schreiber-KI erzeugt bis zu `count` Facts zu einem Thema, danach die Code-Prüfung.
 * `pending` sind Facts, die gerade noch geprüft werden – sie zählen schon als vorhanden.
 */
export async function writeBatch(topicId: string, count: number, pending: KnownFact[] = []): Promise<Candidate[]> {
  const known = [...(await knownFacts()), ...pending];
  const facts = await askForFacts(generatePrompt({
    topicName: await topicName(topicId),
    count,
    existingTitles: known.map((fact) => fact.title),
  }));
  if (!facts.length) throw new Error('Die KI hat keine Facts geliefert.');
  return prepare(topicId, facts.slice(0, count), known);
}

export type GenerateResult = { passed: CheckedDraft[]; rejected: number };

/** Prüf-KI urteilt über alle Kandidaten ohne harten Fehler in einem Auftrag. */
export async function checkBatch(candidates: Candidate[]): Promise<GenerateResult> {
  const open = candidates.filter((fact) => !fact.blocked);
  const facts = open.map(({ title, summary, body, sources, issues }) => ({
    title,
    summary,
    body,
    sources: sources.map(({ title, url }) => ({ title, url })),
    notes: issues,
  }));
  const verdicts = facts.length
    ? ((await runAs('checker', verifyPrompt(facts), VERDICTS_SCHEMA)) as { verdicts?: Verdict[] }).verdicts ?? []
    : [];

  const passed: CheckedDraft[] = [];
  open.forEach(({ blocked, ...draft }, index) => {
    const verdict = verdicts[index];
    if (verdict?.ok) passed.push({ ...draft, review: verdict.reason });
    else console.log(`Verworfen: „${draft.title}“ – ${verdict?.reason ?? 'kein Urteil'}`);
  });
  for (const fact of candidates.filter((c) => c.blocked)) {
    console.log(`Verworfen: „${fact.title}“ – ${fact.issues.join(', ')}`);
  }
  return { passed, rejected: candidates.length - passed.length };
}

/** Prüft einen von Hand bearbeiteten Entwurf erneut, ohne dass eine KI etwas ändert. */
export async function recheckDraft(draftId: number, edited: GeneratedFact & { topic_id: string }): Promise<PreparedDraft> {
  const { topic_id, ...fact } = edited;
  const [{ blocked, ...prepared }] = await prepare(topic_id, [fact], await knownFacts(draftId), { shorten: false });
  return prepared;
}
