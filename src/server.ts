import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { mkdirSync } from 'node:fs';
import { countPublishedByTopic, getTopics } from './supabase.ts';

// Die Anmelde-Ordner der KI-CLIs liegen im Daten-Volume und sind beim ersten Start noch leer.
for (const dir of [process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME]) {
  if (dir) mkdirSync(dir, { recursive: true });
}

const app = new Hono();

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: error.message }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/topics', async (c) => c.json(await getTopics()));

app.get('/api/overview', async (c) => {
  const [topics, counts] = await Promise.all([getTopics(), countPublishedByTopic()]);
  return c.json(topics.map((topic) => ({ ...topic, published: counts[topic.id] ?? 0 })));
});

// Die mit `npm run build` gebaute Oberfläche.
app.use('/*', serveStatic({ root: './dist/web' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Nugget Studio läuft auf http://localhost:${port}`);
});
