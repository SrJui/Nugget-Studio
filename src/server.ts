import './config.ts';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { countPublishedByTopic, getTopics } from './supabase.ts';
import { countOpenDrafts } from './drafts.ts';
import { work } from './jobs.ts';
import { settings } from './routes/settings.ts';
import { jobs } from './routes/jobs.ts';
import { drafts } from './routes/drafts.ts';

const app = new Hono();

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: error.message }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/topics', async (c) => c.json(await getTopics()));

/** Zahlen für die Kopfzeile: veröffentlicht insgesamt und bereit zum Veröffentlichen. */
app.get('/api/stats', async (c) => {
  const counts = Object.values(await countPublishedByTopic());
  return c.json({ published: counts.reduce((sum, n) => sum + n, 0), ready: countOpenDrafts() });
});

app.route('/api/settings', settings);
app.route('/api/jobs', jobs);
app.route('/api/drafts', drafts);

// Die mit `npm run build` gebaute Oberfläche.
app.use('/*', serveStatic({ root: './dist/web' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Nugget Studio läuft auf http://localhost:${port}`);
});

// Aufträge, die vor einem Neustart noch liefen, weiter abarbeiten.
void work();
