import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

const app = new Hono();

app.get('/api/health', (c) => c.json({ ok: true }));

// Die mit `npm run build` gebaute Oberfläche.
app.use('/*', serveStatic({ root: './dist/web' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Nugget Studio läuft auf http://localhost:${port}`);
});
