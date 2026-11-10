import { runWithActiveProvider } from './ai/provider.ts';
import { FACTS_SCHEMA, generatePrompt, regeneratePrompt, shortenPrompt, type GeneratedFact } from './ai/prompt.ts';
import { checkSources, contentIssues, findDuplicate, isTooLong, type KnownFact } from './checks.ts';
import { openDraftsAsKnown, type Draft, type PreparedDraft } from './drafts.ts';
import { getKnownFacts, getTopics } from './supabase.ts';

async function askForFacts(prompt: string): Promise<GeneratedFact[]> {
  const result = (await runWithActiveProvider(prompt, FACTS_SCHEMA)) as { facts?: GeneratedFact[] };
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
): Promise<PreparedDraft[]> {
  const tooLong = shorten ? facts.filter(isTooLong) : [];
  if (tooLong.length) {
    const shortened = await askForFacts(shortenPrompt(tooLong));
    tooLong.forEach((fact, index) => {
      if (shortened[index]) Object.assign(fact, shortened[index]);
    });
  }

  const prepared: PreparedDraft[] = [];
  for (const fact of facts) {
    const sources = await checkSources(fact.sources);
    const issues = contentIssues(fact);
    for (const source of sources) {
      if (!source.ok) issues.push(`Quelle nicht erreichbar: ${source.title}`);
    }
    const duplicate = findDuplicate(fact, [...known, ...prepared]);
    if (duplicate) issues.push(`Mögliche Dublette von „${duplicate}“`);
    prepared.push({ topic_id: topicId, ...fact, sources, issues });
  }
  return prepared;
}

/** Erzeugt bis zu `count` neue Entwürfe zu einem Thema. */
export async function generateDrafts(topicId: string, count: number, direction: string): Promise<PreparedDraft[]> {
  const known = await knownFacts();
  const facts = await askForFacts(generatePrompt({
    topicName: await topicName(topicId),
    count,
    direction,
    existingTitles: known.map((fact) => fact.title),
  }));
  return prepare(topicId, facts.slice(0, count), known);
}

/** Erzeugt einen Entwurf neu, mit dem Hinweis, was besser werden soll. */
export async function regenerateDraft(draft: Draft, hint: string): Promise<PreparedDraft> {
  const known = await knownFacts(draft.id);
  const [fact] = await askForFacts(regeneratePrompt({
    topicName: await topicName(draft.topic_id),
    previous: { title: draft.title, summary: draft.summary, body: draft.body, sources: draft.sources.map(({ title, url }) => ({ title, url })) },
    hint,
    existingTitles: known.map((f) => f.title),
  }));
  if (!fact) throw new Error('Die KI hat keinen neuen Fact geliefert.');
  const [prepared] = await prepare(draft.topic_id, [fact], known);
  return prepared;
}

/** Prüft einen von Hand bearbeiteten Entwurf erneut, ohne dass die KI etwas ändert. */
export async function recheckDraft(draftId: number, edited: GeneratedFact & { topic_id: string }): Promise<PreparedDraft> {
  const { topic_id, ...fact } = edited;
  const [prepared] = await prepare(topic_id, [fact], await knownFacts(draftId), { shorten: false });
  return prepared;
}
