import { db } from './db.ts';
import type { CheckedSource, KnownFact } from './checks.ts';

export type Draft = {
  id: number;
  job_id: number | null;
  topic_id: string;
  title: string;
  summary: string;
  body: string;
  sources: CheckedSource[];
  issues: string[];
  status: 'open' | 'published';
  fact_id: string | null;
  created_at: string;
};

/** Inhalt eines Entwurfs nach Erzeugung und automatischer Prüfung. */
export type PreparedDraft = Pick<Draft, 'topic_id' | 'title' | 'summary' | 'body' | 'sources' | 'issues'>;

function toDraft(row: Record<string, unknown>): Draft {
  return {
    ...(row as Omit<Draft, 'sources' | 'issues'>),
    sources: JSON.parse(row.sources as string),
    issues: JSON.parse(row.issues as string),
  };
}

export function listOpenDrafts(): Draft[] {
  return db.prepare("SELECT * FROM drafts WHERE status = 'open' ORDER BY id").all().map(toDraft);
}

export function getDraft(id: number): Draft | undefined {
  const row = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id);
  return row ? toDraft(row) : undefined;
}

export function insertDraft(jobId: number | null, draft: PreparedDraft) {
  db.prepare(
    'INSERT INTO drafts (job_id, topic_id, title, summary, body, sources, issues) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(jobId, draft.topic_id, draft.title, draft.summary, draft.body, JSON.stringify(draft.sources), JSON.stringify(draft.issues));
}

export function updateDraft(id: number, draft: PreparedDraft) {
  db.prepare(
    'UPDATE drafts SET topic_id = ?, title = ?, summary = ?, body = ?, sources = ?, issues = ? WHERE id = ?',
  ).run(draft.topic_id, draft.title, draft.summary, draft.body, JSON.stringify(draft.sources), JSON.stringify(draft.issues), id);
}

export function deleteDraft(id: number) {
  db.prepare("DELETE FROM drafts WHERE id = ? AND status = 'open'").run(id);
}

export function markPublished(id: number, factId: string) {
  db.prepare("UPDATE drafts SET status = 'published', fact_id = ? WHERE id = ?").run(factId, id);
}

/** Offene Entwürfe als bekannte Facts (veröffentlichte stehen schon in Supabase). */
export function openDraftsAsKnown(exceptId?: number): KnownFact[] {
  return listOpenDrafts()
    .filter((draft) => draft.id !== exceptId)
    .map(({ title, summary }) => ({ title, summary }));
}

export function countOpenDraftsByTopic(): Record<string, number> {
  const rows = db.prepare("SELECT topic_id, COUNT(*) AS n FROM drafts WHERE status = 'open' GROUP BY topic_id").all();
  return Object.fromEntries(rows.map((row) => [row.topic_id as string, row.n as number]));
}
