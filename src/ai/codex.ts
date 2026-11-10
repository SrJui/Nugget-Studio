import { aiWorkDir } from '../config.ts';
import { CodexClient, type RpcMessage } from './codex-client.ts';
import type { AiProvider } from './provider.ts';

type Account = { type: string; email?: string | null; planType?: string };

export type CodexLogin = {
  state: 'idle' | 'waiting' | 'done' | 'error';
  url?: string;
  code?: string;
  message?: string;
};

async function withClient<T>(fn: (client: CodexClient) => Promise<T>): Promise<T> {
  const client = new CodexClient();
  try {
    await client.initialize();
    return await fn(client);
  } finally {
    client.close();
  }
}

async function readAccount(client: CodexClient): Promise<Account | null> {
  const { account } = await client.request<{ account: Account | null }>('account/read', { refreshToken: false });
  return account;
}

// --- Anmeldung per Code (funktioniert auch, wenn Browser und Server verschiedene Rechner sind) ---

let login: CodexLogin = { state: 'idle' };
let loginClient: CodexClient | undefined;
let loginTimer: NodeJS.Timeout | undefined;

export function codexLoginState(): CodexLogin {
  return login;
}

function finishLogin(result: CodexLogin) {
  login = result;
  clearTimeout(loginTimer);
  const client = loginClient;
  loginClient = undefined;
  client?.close();
}

export async function startCodexLogin(): Promise<CodexLogin> {
  if (login.state === 'waiting') return login;

  const client = new CodexClient();
  loginClient = client;
  client.subscribe((message) => {
    if (loginClient !== client) return;
    if (message.method === 'account/login/completed') {
      finishLogin(message.params?.success
        ? { state: 'done' }
        : { state: 'error', message: String(message.params?.error || 'ChatGPT-Anmeldung fehlgeschlagen.') });
    } else if (message.method === 'nugget/disconnected') {
      finishLogin({ state: 'error', message: 'Codex wurde während der Anmeldung beendet. Bitte erneut versuchen.' });
    }
  });

  try {
    await client.initialize();
    const result = await client.request<{ verificationUrl: string; userCode: string }>(
      'account/login/start', { type: 'chatgptDeviceCode' },
    );
    // Eine bereits abgeschlossene Anmeldung darf nicht wieder auf „wartet“ springen.
    if (loginClient === client) {
      login = { state: 'waiting', url: result.verificationUrl, code: result.userCode };
      loginTimer = setTimeout(
        () => finishLogin({ state: 'error', message: 'Der Code ist abgelaufen. Bitte erneut anmelden.' }),
        15 * 60_000,
      );
    }
    return login;
  } catch (error) {
    finishLogin({ state: 'error', message: (error as Error).message });
    throw error;
  }
}

/** Meldet Nugget Studios eigenen Codex-Login ab. */
export async function codexLogout() {
  finishLogin({ state: 'idle' });
  await withClient((client) => client.request('account/logout'));
}

// --- Anbieter ---

export const codex: AiProvider = {
  id: 'codex',
  label: 'ChatGPT',

  async status() {
    try {
      const account = await withClient(readAccount);
      return account?.type === 'chatgpt'
        ? { loggedIn: true, detail: [account.email, account.planType].filter(Boolean).join(' · ') }
        : { loggedIn: false };
    } catch (error) {
      return { loggedIn: false, detail: (error as Error).message };
    }
  },

  async models() {
    return withClient(async (client) => {
      const models = [];
      let cursor: string | null = null;
      do {
        const page: { data: { model: string; displayName: string }[]; nextCursor: string | null } =
          await client.request('model/list', { limit: 100, cursor, includeHidden: false });
        models.push(...page.data.map((model) => ({ id: model.model, label: model.displayName || model.model })));
        cursor = page.nextCursor;
      } while (cursor);
      return models;
    });
  },

  async run(prompt, schema, model) {
    const client = new CodexClient();
    let threadId: string | undefined;
    let finalText = '';
    let complete!: (outcome: Error | { status: string; error?: { message: string } | null }) => void;
    const completed = new Promise<Error | { status: string; error?: { message: string } | null }>((resolve) => {
      complete = resolve;
    });
    const timer = setTimeout(() => {
      complete(new Error('ChatGPT hat das Zeitlimit erreicht. Bitte erneut versuchen.'));
      client.close();
    }, 15 * 60_000);

    const unsubscribe = client.subscribe((message: RpcMessage) => {
      const params = message.params ?? {};
      if (message.method === 'nugget/disconnected') {
        complete(new Error(String(params.message)));
        return;
      }
      // Rückfragen von Codex (z. B. Freigaben) brauchen eine Antwort, sonst wartet Codex bis zum Zeitlimit.
      if (message.id !== undefined && message.method) {
        client.send({ id: message.id, error: { message: 'In Nugget Studio nicht verfügbar.' } });
        return;
      }
      if (params.threadId !== threadId) return;
      if (message.method === 'item/completed') {
        const item = params.item as { type: string; text?: string };
        if (item.type === 'agentMessage' && item.text) finalText = item.text;
      } else if (message.method === 'turn/completed') {
        complete(params.turn as { status: string; error?: { message: string } | null });
      }
    });

    try {
      await client.initialize();
      if ((await readAccount(client))?.type !== 'chatgpt') {
        throw new Error('Bitte in den Einstellungen zuerst mit ChatGPT anmelden.');
      }
      const thread = await client.request<{ thread: { id: string } }>('thread/start', {
        cwd: aiWorkDir,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
        modelProvider: 'openai',
        ...(model ? { model } : {}),
      });
      threadId = thread.thread.id;
      await client.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt, text_elements: [] }],
        outputSchema: schema,
      });

      const outcome = await completed;
      if (outcome instanceof Error) throw outcome;
      if (outcome.status !== 'completed') throw new Error(outcome.error?.message || `ChatGPT-Lauf ${outcome.status}.`);
      try {
        return JSON.parse(finalText);
      } catch {
        throw new Error('ChatGPT hat kein Ergebnis im erwarteten Format geliefert.');
      }
    } finally {
      clearTimeout(timer);
      unsubscribe();
      client.close();
    }
  },
};
