import { escapeHtml, getJSON, sendJSON } from '../helpers.ts';

type Provider = { id: 'claude' | 'codex'; label: string; loggedIn: boolean; detail?: string };
type Settings = { active: Provider['id']; providers: Provider[] };
type CodexLogin = { state: 'idle' | 'waiting' | 'done' | 'error'; url?: string; code?: string; message?: string };

export async function renderSettings(root: HTMLElement) {
  root.innerHTML = '<h1>Einstellungen</h1><p>Lädt …</p>';
  let settings: Settings;
  try {
    settings = await getJSON<Settings>('/api/settings');
  } catch (error) {
    root.innerHTML = `<h1>Einstellungen</h1><p class="error">${escapeHtml((error as Error).message)}</p>`;
    return;
  }

  const [claude, codex] = settings.providers;
  root.innerHTML = `
    <h1>Einstellungen</h1>

    <section class="card">
      <h2>KI-Anbieter</h2>
      ${settings.providers.map((provider) => `
        <label class="choice">
          <input type="radio" name="provider" value="${provider.id}" ${provider.id === settings.active ? 'checked' : ''}>
          ${escapeHtml(provider.label)} ${badge(provider)}
        </label>`).join('')}
    </section>

    <section class="card">
      <h2>${escapeHtml(claude.label)} ${badge(claude)}</h2>
      <p class="hint">Auf dem Mac im Terminal <code>claude setup-token</code> ausführen und den Schlüssel hier einfügen.</p>
      <form id="claude-form" class="row">
        <input type="password" name="token" placeholder="Schlüssel einfügen" autocomplete="off" required>
        <button>Speichern</button>
        ${claude.loggedIn ? '<button type="button" id="claude-remove" class="secondary">Entfernen</button>' : ''}
      </form>
    </section>

    <section class="card">
      <h2>${escapeHtml(codex.label)} ${badge(codex)}</h2>
      <div id="codex-login">
        ${codex.loggedIn
          ? '<button id="codex-logout" class="secondary">Abmelden</button>'
          : '<button id="codex-start">Mit ChatGPT anmelden</button>'}
      </div>
    </section>

    <section class="card">
      <h2>Verbindung testen</h2>
      <p class="hint">Schickt einen kleinen Auftrag an den gewählten Anbieter.</p>
      <button id="test">Testen</button>
      <p id="test-result"></p>
    </section>`;

  const rerender = () => renderSettings(root);

  for (const radio of root.querySelectorAll<HTMLInputElement>('input[name="provider"]')) {
    radio.addEventListener('change', () => sendJSON('PUT', '/api/settings/provider', { provider: radio.value }));
  }

  root.querySelector<HTMLFormElement>('#claude-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = new FormData(event.target as HTMLFormElement).get('token');
    await runAction(() => sendJSON('PUT', '/api/settings/claude/token', { token }));
    rerender();
  });

  root.querySelector('#claude-remove')?.addEventListener('click', async () => {
    await runAction(() => sendJSON('DELETE', '/api/settings/claude/token'));
    rerender();
  });

  root.querySelector('#codex-start')?.addEventListener('click', async () => {
    const login = await sendJSON<CodexLogin>('POST', '/api/settings/codex/login');
    showCodexLogin(root, login, rerender);
  });

  root.querySelector('#codex-logout')?.addEventListener('click', async () => {
    await runAction(() => sendJSON('DELETE', '/api/settings/codex/login'));
    rerender();
  });

  root.querySelector('#test')!.addEventListener('click', async () => {
    const output = root.querySelector('#test-result')!;
    output.className = '';
    output.textContent = 'Läuft … (kann bis zu einer Minute dauern)';
    try {
      const result = await sendJSON<{ provider: string; result: unknown; seconds: number }>('POST', '/api/settings/test');
      output.textContent = `${result.provider} hat in ${result.seconds} s geantwortet: ${JSON.stringify(result.result)}`;
    } catch (error) {
      output.className = 'error';
      output.textContent = (error as Error).message;
    }
  });
}

function badge(provider: Provider): string {
  const text = provider.loggedIn ? 'angemeldet' : 'nicht angemeldet';
  return `<span class="badge ${provider.loggedIn ? 'ok' : ''}" title="${escapeHtml(provider.detail ?? '')}">${text}</span>`;
}

/** Zeigt Link und Code der ChatGPT-Anmeldung und wartet, bis sie bestätigt ist. */
function showCodexLogin(root: HTMLElement, login: CodexLogin, onFinished: () => void) {
  const box = root.querySelector('#codex-login')!;
  if (login.state === 'waiting' && login.url && login.code) {
    box.innerHTML = `
      <ol>
        <li><a href="${escapeHtml(login.url)}" target="_blank" rel="noreferrer">${escapeHtml(login.url)}</a> öffnen und anmelden</li>
        <li>Diesen Code eingeben: <code class="big">${escapeHtml(login.code)}</code></li>
      </ol>
      <p class="hint">Wartet auf deine Bestätigung …</p>`;
    setTimeout(async () => {
      showCodexLogin(root, await getJSON<CodexLogin>('/api/settings/codex/login'), onFinished);
    }, 3000);
  } else if (login.state === 'error') {
    box.innerHTML = `<p class="error">${escapeHtml(login.message ?? 'Anmeldung fehlgeschlagen')}</p>`;
  } else {
    onFinished();
  }
}

/** Führt eine Aktion aus und zeigt einen Fehler als Hinweis an. */
async function runAction(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    alert((error as Error).message);
  }
}
