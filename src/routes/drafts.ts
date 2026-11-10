import { Hono } from 'hono';
import { contentIssues } from '../checks.ts';
import { deleteDraft, getDraft, listOpenDrafts, markPublished, updateDraft, type Draft } from '../drafts.ts';
import { recheckDraft, regenerateDraft } from '../generate.ts';
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
  const draft = openDraft(c.req.param('id'));
  const blocking = contentIssues(draft);
  if (blocking.length) return c.json({ error: `Kann nicht freigeben: ${blocking.join(', ')}` }, 400);
  const factId = await publishFact({
    ...draft,
    sources: draft.sources.map(({ title, url }) => ({ title, url })),
  });
  markPublished(draft.id, factId);
  return c.json({ ok: true, factId });
});

drafts.delete('/:id', (c) => {
  deleteDraft(openDraft(c.req.param('id')).id);
  return c.json({ ok: true });
});

drafts.post('/:id/regenerate', async (c) => {
  const draft = openDraft(c.req.param('id'));
  const { hint } = await c.req.json();
  updateDraft(draft.id, await regenerateDraft(draft, isText(hint) ? hint.trim() : ''));
  return c.json(getDraft(draft.id));
});
