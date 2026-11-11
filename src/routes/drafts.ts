import { Hono } from 'hono';
import { contentIssues } from '../checks.ts';
import { deleteDraft, getDraft, listOpenDrafts, markPublished, updateDraft, type Draft } from '../drafts.ts';
import { recheckDraft } from '../generate.ts';
import { publishFact } from '../supabase.ts';

export const drafts = new Hono();

/** Der offene Entwurf zur ID in der Adresse, sonst ein Fehler. */
function openDraft(id: string): Draft {
  const draft = getDraft(Number(id));
  if (!draft || draft.status !== 'open') throw new Error('Entwurf nicht gefunden oder schon erledigt.');
  return draft;
}

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

/** Trägt den Entwurf in Supabase ein. Wirft einen Fehler, wenn noch etwas Wichtiges fehlt. */
async function publishDraft(draft: Draft) {
  const blocking = contentIssues(draft);
  if (blocking.length) throw new Error(`„${draft.title}“ kann nicht veröffentlicht werden: ${blocking.join(', ')}`);
  const factId = await publishFact({
    ...draft,
    sources: draft.sources.map(({ title, url }) => ({ title, url })),
  });
  markPublished(draft.id, factId);
}

drafts.get('/', (c) => c.json(listOpenDrafts()));

/** Übernimmt Änderungen von Hand und prüft den Entwurf erneut. */
drafts.put('/:id', async (c) => {
  const draft = openDraft(c.req.param('id'));
  const { topic_id, title, summary, body, sources } = await c.req.json();
  const validSources = Array.isArray(sources) && sources.every((s) => isText(s?.title) && isText(s?.url));
  if (![topic_id, title, summary, body].every(isText) || !validSources) {
    return c.json({ error: 'Ungültige Angaben.' }, 400);
  }
  const prepared = await recheckDraft(draft.id, {
    topic_id,
    title: title.trim(),
    summary: summary.trim(),
    body: body.trim(),
    sources: sources
      .map((s: { title: string; url: string }) => ({ title: s.title.trim(), url: s.url.trim() }))
      .filter((s: { title: string; url: string }) => s.title && s.url),
  });
  updateDraft(draft.id, prepared);
  return c.json(getDraft(draft.id));
});

drafts.post('/:id/publish', async (c) => {
  await publishDraft(openDraft(c.req.param('id')));
  return c.json({ ok: true });
});

/** Veröffentlicht alle offenen Entwürfe nacheinander. Einzelne Fehler halten den Rest nicht auf. */
drafts.post('/publish-all', async (c) => {
  let published = 0;
  const errors: string[] = [];
  for (const draft of listOpenDrafts()) {
    try {
      await publishDraft(draft);
      published++;
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  return c.json({ published, errors });
});

drafts.delete('/:id', (c) => {
  deleteDraft(openDraft(c.req.param('id')).id);
  return c.json({ ok: true });
});
