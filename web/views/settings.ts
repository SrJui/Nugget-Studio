import { escapeHtml, getJSON, sendJSON } from '../helpers.ts';

type ProviderId = 'claude' | 'codex';
type Provider = { id: ProviderId; label: string; loggedIn: boolean; detail?: string; model: string };
type Settings = { active: ProviderId; providers: Provider[] };
type ModelOption = { id: string; label: string };
type CodexLogin = { state: 'idle' | 'waiting' | 'done' | 'error'; url?: string; code?: string; message?: string };

const CLAUDE_LOGIN_COMMAND = 'docker compose exec -it studio claude auth login';

export async function renderSettings(root: HTMLElement) {
  root.innerHTML = '<h1>Einstellungen</h1><p>Lädt …</p>';
  let settings: Settings;
  try {
    settings = await getJSON<Settings>('/api/settings');
  } catch (error) {
    root.innerHTML = `<h1>Einstellungen</h1><p class="error">${escapeHtml((error as Error).message)}</p>`;
    return;
  }

  const claude = settings.providers.find((provider) => provider.id === 'claude')!;
  const codex = settings.providers.find((provider) => provider.id === 'codex')!;

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
      ${claude.loggedIn
        ? modelPicker(claude)
        : `<p class="hint">Einmal auf dem Server im Ordner von Nugget Studio ausführen und den Anweisungen folgen:</p>
           <pre><code>${CLAUDE_LOGIN_COMMAND}</code></pre>
           <button id="claude-refresh" class="secondary">Status neu prüfen</button>`}
    </section>

    <section class="card">
      <h2>${escapeHtml(codex.label)} ${badge(codex)}</h2>
      ${codex.loggedIn ? modelPicker(codex) : ''}
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

  for (const provider of [claude, codex]) {
    if (provider.loggedIn) loadModels(root, provider);
  }

  root.querySelector('#claude-refresh')?.addEventListener('click', rerender);

  root.querySelector('#codex-start')?.addEventListener('click', async () => {
    try {
      showCodexLogin(root, await sendJSON<CodexLogin>('POST', '/api/settings/codex/login'), rerender);
    } catch (error) {
      alert((error as Error).message);
    }
  });

  root.querySelector('#codex-logout')?.addEventListener('click', async () => {
    try {
      await sendJSON('POST', '/api/settings/codex/logout');
    } catch (error) {
      alert((error as Error).message);
    }
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
  const text = provider.loggedIn ? `angemeldet${provider.detail ? ` · ${provider.detail}` : ''}` : 'nicht angemeldet';
  return `<span class="badge ${provider.loggedIn ? 'ok' : ''}">${escapeHtml(text)}</span>`;
}

function modelPicker(provider: Provider): string {
  return `
    <label class="row">Modell
      <select id="model-${provider.id}" disabled><option>Lädt …</option></select>
    </label>`;
}

/** Füllt die Modellauswahl eines angemeldeten Anbieters und speichert Änderungen. */
async function loadModels(root: HTMLElement, provider: Provider) {
  const select = root.querySelector<HTMLSelectElement>(`#model-${provider.id}`)!;
  try {
    const models = await getJSON<ModelOption[]>(`/api/settings/models?provider=${provider.id}`);
    select.innerHTML = [{ id: '', label: 'Standard' }, ...models]
      .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === provider.model ? 'selected' : ''}>${escapeHtml(model.label)}</option>`)
      .join('');
    select.disabled = false;
    select.addEventListener('change', () =>
      sendJSON('PUT', '/api/settings/model', { provider: provider.id, model: select.value }));
  } catch (error) {
    select.innerHTML = `<option>${escapeHtml((error as Error).message)}</option>`;
  }
}

/** Zeigt Link und Code der ChatGPT-Anmeldung und wartet, bis sie bestätigt ist. */
function showCodexLogin(root: HTMLElement, login: CodexLogin, onFinished: () => void) {
  const box = root.querySelector('#codex-login');
  if (!box) return; // Seite wurde inzwischen gewechselt
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
    box.innerHTML = `<p class="error">${escapeHtml(login.message ?? 'Anmeldung fehlgeschlagen')}</p>
      <button id="codex-start-again">Erneut versuchen</button>`;
    box.querySelector('#codex-start-again')!.addEventListener('click', onFinished);
  } else {
    onFinished();
  }
}
