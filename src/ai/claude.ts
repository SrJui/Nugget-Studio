import { query, type AccountInfo, type Options } from '@anthropic-ai/claude-agent-sdk';
import { aiWorkDir } from '../config.ts';
import type { AiProvider } from './provider.ts';

/**
 * Claude-Abo über das Claude Agent SDK. Nutzt den Login aus `claude auth login`
 * (im Container: `docker compose exec -it studio claude auth login`).
 */

const WEB_TOOLS = ['WebSearch', 'WebFetch'];

/** Umgebung ohne API-Schlüssel, damit wirklich das Abo genutzt wird. */
function subscriptionEnv(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'nugget-studio';
  return env;
}

const baseOptions = (): Options => ({
  cwd: aiWorkDir,
  settingSources: [],
  env: subscriptionEnv(),
});

/** Startet kurz eine Sitzung ohne Auftrag, um Login-Infos oder Modelle abzufragen. */
async function withIdleQuery<T>(fn: (q: ReturnType<typeof query>) => Promise<T>, timeoutMs = 20_000): Promise<T> {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => (release = resolve));
  async function* idle() {
    await hold;
  }
  const q = query({ prompt: idle(), options: { ...baseOptions(), tools: [], persistSession: false } });
  try {
    return await Promise.race([
      fn(q),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Zeitüberschreitung beim Prüfen des Claude-Logins')), timeoutMs),
      ),
    ]);
  } finally {
    release();
    q.close();
  }
}

function isLoggedIn(info: AccountInfo) {
  // Ohne Login meldet das SDK `tokenSource: "none"` – das zählt nicht als angemeldet.
  const hasToken = Boolean(info.tokenSource) && info.tokenSource !== 'none';
  return info.apiProvider === 'firstParty' && Boolean(info.email || info.subscriptionType || hasToken);
}

function describeAssistantError(error: string) {
  switch (error) {
    case 'authentication_failed':
      return 'Claude-Login ungültig oder abgelaufen. Bitte neu anmelden (siehe Einstellungen).';
    case 'rate_limit':
      return 'Nutzungslimit deines Claude-Abos erreicht. Bitte später erneut versuchen.';
    case 'billing_error':
      return 'Problem mit der Abrechnung deines Claude-Accounts.';
    case 'overloaded':
      return 'Claude ist gerade überlastet. Bitte gleich nochmal versuchen.';
    case 'model_not_found':
      return 'Das eingestellte Modell ist für dein Abo nicht verfügbar. Bitte in den Einstellungen ein anderes wählen.';
    default:
      return `Claude-Fehler: ${error}`;
  }
}

export const claude: AiProvider = {
  id: 'claude',
  label: 'Claude',

  async status() {
    try {
      const info = await withIdleQuery((q) => q.accountInfo());
      return isLoggedIn(info)
        ? { loggedIn: true, detail: [info.email, info.subscriptionType].filter(Boolean).join(' · ') }
        : { loggedIn: false };
    } catch (error) {
      return { loggedIn: false, detail: (error as Error).message };
    }
  },

  async models() {
    const models = await withIdleQuery((q) => q.supportedModels());
    return models.map((model) => ({ id: model.value, label: model.displayName || model.value }));
  },

  async run(prompt, schema, model) {
    const q = query({
      prompt,
      options: {
        ...baseOptions(),
        tools: WEB_TOOLS,
        allowedTools: WEB_TOOLS,
        permissionMode: 'dontAsk',
        persistSession: false,
        maxTurns: 40,
        outputFormat: { type: 'json_schema', schema: schema as Record<string, unknown> },
        ...(model ? { model } : {}),
      },
    });

    for await (const message of q) {
      if (message.type === 'assistant' && message.error) {
        throw new Error(describeAssistantError(message.error));
      }
      if (message.type === 'result') {
        if (message.subtype !== 'success') throw new Error(`Claude-Lauf abgebrochen (${message.subtype}).`);
        if (message.structured_output === undefined) throw new Error('Claude hat kein Ergebnis im erwarteten Format geliefert.');
        return message.structured_output;
      }
    }
    throw new Error('Claude hat keine Antwort geliefert.');
  },
};
