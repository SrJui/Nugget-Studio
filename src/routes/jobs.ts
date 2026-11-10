import { Hono } from 'hono';
import { cancelJob, createJob, listJobs } from '../jobs.ts';
import { getTopics } from '../supabase.ts';

export const jobs = new Hono();

jobs.get('/', (c) => c.json(listJobs()));

jobs.post('/', async (c) => {
  const { count, topics, direction } = await c.req.json();
  const validTopics = new Set((await getTopics()).map((topic) => topic.id));

  if (!Number.isInteger(count) || count < 1 || count > 200) {
    return c.json({ error: 'Anzahl muss zwischen 1 und 200 liegen.' }, 400);
  }
  if (!Array.isArray(topics) || !topics.length || !topics.every((topic) => validTopics.has(topic))) {
    return c.json({ error: 'Bitte mindestens ein gültiges Thema wählen.' }, 400);
  }
  return c.json(createJob(count, topics, typeof direction === 'string' ? direction.trim() : ''));
});

jobs.post('/:id/cancel', (c) => {
  cancelJob(Number(c.req.param('id')));
  return c.json({ ok: true });
});
