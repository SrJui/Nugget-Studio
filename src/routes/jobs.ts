import { Hono } from 'hono';
import { cancelJob, createJob, listJobs } from '../jobs.ts';
import { getTopics } from '../supabase.ts';

export const jobs = new Hono();

jobs.get('/', (c) => c.json(listJobs()));

/** Neuer Auftrag über alle Themen. */
jobs.post('/', async (c) => {
  const { count } = await c.req.json();
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    return c.json({ error: 'Anzahl muss zwischen 1 und 200 liegen.' }, 400);
  }
  const topics = (await getTopics()).map((topic) => topic.id);
  if (!topics.length) return c.json({ error: 'In Supabase sind keine Themen angelegt.' }, 400);
  return c.json(createJob(count, topics));
});

jobs.post('/:id/cancel', (c) => {
  cancelJob(Number(c.req.param('id')));
  return c.json({ ok: true });
});
