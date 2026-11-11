import { db } from './db.ts';
import { insertDraft } from './drafts.ts';
import { checkBatch, writeBatch, type Candidate, type GenerateResult } from './generate.ts';

export type Job = {
  id: number;
  count: number;
  topics: string[];
  status: 'running' | 'done' | 'failed' | 'cancelled';
  created: number;
  rejected: number;
  error: string | null;
  created_at: string;
};

const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;
/** Ab so vielen Verworfenen pro bestelltem Fact gibt der Auftrag auf, damit die Kosten nicht ausufern. */
const MAX_REJECTED_PER_FACT = 3;

function toJob(row: Record<string, unknown>): Job {
  return { ...(row as Omit<Job, 'topics'>), topics: JSON.parse(row.topics as string) };
}

function getJob(id: number): Job {
  return toJob(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id)!);
}

export function listJobs(): Job[] {
  return db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 10').all().map(toJob);
}

export function createJob(count: number, topics: string[]): Job {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO jobs (count, topics) VALUES (?, ?)')
    .run(count, JSON.stringify(topics));
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
/** Das Thema, zu dem dieser Auftrag bisher die wenigsten Entwürfe hat (Facts in Prüfung zählen mit). */
function nextTopic(job: Job, pending: Candidate[]): string {
  const rows = db.prepare('SELECT topic_id, COUNT(*) AS n FROM drafts WHERE job_id = ? GROUP BY topic_id').all(job.id);
  const counts: Record<string, number> = Object.fromEntries(rows.map((row) => [row.topic_id as string, row.n as number]));
  for (const fact of pending) counts[fact.topic_id] = (counts[fact.topic_id] ?? 0) + 1;
  return job.topics.reduce((best, topic) => ((counts[topic] ?? 0) < (counts[best] ?? 0) ? topic : best));
}

/** Ein Durchgang, den die Prüf-KI gerade prüft. */
type Checking = { candidates: Candidate[]; result: Promise<GenerateResult> };

function startCheck(candidates: Candidate[]): Checking {
  const result = checkBatch(candidates);
  // Fehler werden erst im nächsten Durchgang ausgewertet; bis dahin nicht als „unbehandelt“ melden.
  result.catch(() => {});
  return { candidates, result };
}

/**
 * Schreiber und Prüfer arbeiten gleichzeitig: Während die Prüf-KI Durchgang N prüft,
 * schreibt die Schreiber-KI schon Durchgang N+1.
 */
async function processJob(jobId: number) {
  let attempts = 0;
  let checking: Checking | undefined;

  for (;;) {
    const job = getJob(jobId);
    if (job.status !== 'running') return; // abgebrochen: Ergebnisse in Prüfung verfallen
    if (job.rejected >= job.count * MAX_REJECTED_PER_FACT) {
      finish(jobId, 'failed', `Zu viele Facts verworfen (${job.rejected}). Bitte Prüf-Notizen im Server-Log ansehen.`);
      return;
    }

    const pending = checking?.candidates.filter((fact) => !fact.blocked) ?? [];
    const missing = job.count - job.created - pending.length;
    if (missing <= 0 && !checking) break;

    // Höchstens der Anteil eines Themas, damit sich auch kleine Aufträge auf alle Themen verteilen.
    const perTopic = Math.ceil(job.count / job.topics.length);
    const [written, checked] = await Promise.allSettled([
      missing > 0 ? writeBatch(nextTopic(job, pending), Math.min(BATCH_SIZE, perTopic, missing), pending) : undefined,
      checking?.result,
    ]);
    checking = undefined;

    // Nicht übernehmen, wenn der Auftrag inzwischen abgebrochen wurde.
    if (getJob(jobId).status !== 'running') return;
    if (checked.status === 'fulfilled' && checked.value) {
      for (const draft of checked.value.passed) insertDraft(jobId, draft);
      db.prepare('UPDATE jobs SET created = created + ?, rejected = rejected + ? WHERE id = ?')
        .run(checked.value.passed.length, checked.value.rejected, jobId);
    }
    if (written.status === 'fulfilled' && written.value) checking = startCheck(written.value);

    const failure = [written, checked].find((outcome) => outcome.status === 'rejected');
    if (!failure) {
      attempts = 0;
      continue;
    }
    console.error(`Auftrag ${jobId}:`, failure.reason);
    if (++attempts >= MAX_ATTEMPTS) {
      finish(jobId, 'failed', (failure.reason as Error).message);
      return;
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
