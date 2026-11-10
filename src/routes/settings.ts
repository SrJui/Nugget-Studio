import { Hono } from 'hono';
import { setSetting } from '../db.ts';
import { removeClaudeToken, saveClaudeToken } from '../ai/claude.ts';
import { codexLoginState, codexLogout, startCodexLogin } from '../ai/codex.ts';
import { activeProvider, isProviderId, providers } from '../ai/provider.ts';

export const settings = new Hono();

settings.get('/', async (c) => {
  const list = await Promise.all(
    Object.values(providers).map(async (provider) => ({
      id: provider.id,
      label: provider.label,
      ...(await provider.status()),
    })),
  );
  return c.json({ active: activeProvider().id, providers: list });
});

settings.put('/provider', async (c) => {
  const { provider } = await c.req.json();
  if (!isProviderId(provider)) return c.json({ error: 'Unbekannter Anbieter' }, 400);
  setSetting('provider', provider);
  return c.json({ ok: true });
});

settings.put('/claude/token', async (c) => {
  const { token } = await c.req.json();
  if (typeof token !== 'string' || !token.trim()) return c.json({ error: 'Schlüssel fehlt' }, 400);
  saveClaudeToken(token);
  return c.json(await providers.claude.status());
});

settings.delete('/claude/token', (c) => {
  removeClaudeToken();
  return c.json({ ok: true });
});

settings.post('/codex/login', async (c) => c.json(await startCodexLogin()));

settings.get('/codex/login', (c) => c.json(codexLoginState()));

settings.delete('/codex/login', async (c) => {
  await codexLogout();
  return c.json({ ok: true });
});

const TEST_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

settings.post('/test', async (c) => {
  const provider = activeProvider();
  const started = Date.now();
  const result = await provider.run('Antworte im Feld "answer" nur mit dem Wort: ok', TEST_SCHEMA);
  return c.json({ provider: provider.label, result, seconds: Math.round((Date.now() - started) / 1000) });
});
