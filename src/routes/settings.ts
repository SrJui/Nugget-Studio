import { Hono } from 'hono';
import { getSetting, setSetting } from '../db.ts';
import {
  ROLES,
  isProviderId,
  isRole,
  modelSettingKey,
  providerFor,
  providers,
  roleSettingKey,
  runAs,
} from '../ai/provider.ts';

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
  const roles = Object.fromEntries(ROLES.map((role) => [role, providerFor(role).id]));
  return c.json({ roles, providers: list });
});

/** Legt fest, welcher Anbieter schreibt bzw. prüft. */
settings.put('/provider', async (c) => {
  const { role, provider } = await c.req.json();
  if (!isRole(role) || !isProviderId(provider)) return c.json({ error: 'Ungültige Angaben' }, 400);
  setSetting(roleSettingKey(role), provider);
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

const TEST_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
};

/** Schickt Schreiber und Prüfer gleichzeitig einen kleinen Auftrag. */
settings.post('/test', async (c) => {
  const results = await Promise.all(ROLES.map(async (role) => {
    const started = Date.now();
    const provider = providerFor(role).label;
    try {
      const result = await runAs(role, 'Antworte im Feld "answer" nur mit dem Wort: ok', TEST_SCHEMA);
      return { role, provider, ok: true, result, seconds: Math.round((Date.now() - started) / 1000) };
    } catch (error) {
      return { role, provider, ok: false, error: (error as Error).message };
    }
  }));
  return c.json(results);
});
