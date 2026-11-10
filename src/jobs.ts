import { db } from './db.ts';
import { insertDraft } from './drafts.ts';
import { generateDrafts } from './generate.ts';

export type Job = {
  id: number;
  count: number;
  topics: string[];
  direction: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  created: number;
  error: string | null;
  created_at: string;
};

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;

function toJob(row: Record<string, unknown>): Job {
  return { ...(row as Omit<Job, 'topics'>), topics: JSON.parse(row.topics as string) };
}

function getJob(id: number): Job {
  return toJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)!);
}

export function listJobs(): Job[] {
  return db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 10').all().map(toJob);
}

export function createJob(count: number, topics: string[], direction: string): Job {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO jobs (count, topics, direction) VALUES (?, ?, ?)')
    .run(count, JSON.stringify(topics), direction);
  void work();
  return getJob(Number(lastInsertRowid));
}

export function cancelJob(id: number) {
  db.prepare("UPDATE jobs SET status = 'cancelled' WHERE id = ? AND status = 'running'").run(id);
}

function finish(id: number, status: Job['status'], error?: string) {
  db.prepare("UPDATE jobs SET status = ?, error = ? WHERE id = ? AND status = 'running'").run(status, error ?? null, id);
}

/** Das Thema, zu dem dieser Auftrag bisher die wenigsten Entwürfe hat. */
function nextTopic(job: Job): string {
  const rows = db.prepare('SELECT topic_id, COUNT(*) AS n FROM drafts WHERE job_id = ? GROUP BY topic_id').all(job.id);
  const counts = Object.fromEntries(rows.map((row) => [row.topic_id as string, row.n as number]));
  return job.topics.reduce((best, topic) => ((counts[topic] ?? 0) < (counts[best] ?? 0) ? topic : best));
}

async function processJob(jobId: number) {
  let attempts = 0;
  for (let job = getJob(jobId); job.status === 'running' && job.created < job.count; job = getJob(jobId)) {
    const topic = nextTopic(job);
    // Höchstens der Anteil eines Themas, damit sich auch kleine Aufträge auf alle Themen verteilen.
    const perTopic = Math.ceil(job.count / job.topics.length);
    const size = Math.min(BATCH_SIZE, perTopic, job.count - job.created);
    try {
      const drafts = await generateDrafts(topic, size, job.direction);
      if (!drafts.length) throw new Error('Die KI hat keine Facts geliefert.');
      // Nicht übernehmen, wenn der Auftrag inzwischen abgebrochen wurde.
      if (getJob(jobId).status !== 'running') return;
      for (const draft of drafts) insertDraft(jobId, draft);
      db.prepare('UPDATE jobs SET created = created + ? WHERE id = ?').run(drafts.length, jobId);
      attempts = 0;
    } catch (error) {
      console.error(`Auftrag ${jobId}:`, error);
      if (++attempts >= MAX_ATTEMPTS) {
        finish(jobId, 'failed', (error as Error).message);
        return;
      }
    }
  }
  finish(jobId, 'done');
}

let working = false;

/** Arbeitet alle laufenden Aufträge nacheinander ab. Läuft nach einem Neustart weiter. */
export async function work() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const next = db.prepare("SELECT id FROM jobs WHERE status = 'running' ORDER BY id LIMIT 1").get();
      if (!next) break;
      await processJob(next.id as number);
    }
  } finally {
    working = false;
  }
}
