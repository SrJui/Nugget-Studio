import { Hono } from 'hono';
import { getSetting, setSetting } from '../db.ts';
import { codexLoginState, codexLogout, startCodexLogin } from '../ai/codex.ts';
import { activeProvider, isProviderId, modelSettingKey, providers, runWithActiveProvider } from '../ai/provider.ts';

export const settings = new Hono();

settings.get('/', async (c) => {
  const list = await Promise.all(
    Object.values(providers).map(async (provider) => ({
      id: provider.id,
      label: provider.label,
      model: getSetting(modelSettingKey(provider.id)) ?? '',
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

settings.get('/models', async (c) => {
  const provider = c.req.query('provider');
  if (!isProviderId(provider)) return c.json({ error: 'Unbekannter Anbieter' }, 400);
  return c.json(await providers[provider].models());
});

settings.put('/model', async (c) => {
  const { provider, model } = await c.req.json();
  if (!isProviderId(provider) || typeof model !== 'string') return c.json({ error: 'Ungültige Angaben' }, 400);
  setSetting(modelSettingKey(provider), model);
  return c.json({ ok: true });
});

settings.get('/codex/login', (c) => c.json(codexLoginState()));

settings.post('/codex/login', async (c) => c.json(await startCodexLogin()));

settings.post('/codex/logout', async (c) => {
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
  const started = Date.now();
  const result = await runWithActiveProvider('Antworte im Feld "answer" nur mit dem Wort: ok', TEST_SCHEMA);
  return c.json({
    provider: activeProvider().label,
    result,
    seconds: Math.round((Date.now() - started) / 1000),
  });
});
