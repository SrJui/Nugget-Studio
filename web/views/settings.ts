import { escapeHtml, getJSON, sendJSON } from '../helpers.ts';

type ProviderId = 'claude' | 'codex';
type Provider = { id: ProviderId; label: string; loggedIn: boolean; detail?: string; model: string };
type Settings = { active: ProviderId; providers: Provider[] };
type ModelOption = { id: string; label: string };

/** Einmalige Anmeldung im Server-Terminal, im Ordner von Nugget Studio. */
const LOGIN_COMMANDS: Record<ProviderId, string> = {
  claude: 'docker compose exec -it studio claude auth login',
  codex: 'docker compose exec -it studio codex login --device-auth',
};

export async function renderSettings(root: HTMLElement) {
  root.innerHTML = '<h1>Einstellungen</h1><p>Lädt …</p>';
  let settings: Settings;
  try {
    settings = await getJSON<Settings>('/api/settings');
  } catch (error) {
    root.innerHTML = `<h1>Einstellungen</h1><p class="error">${escapeHtml((error as Error).message)}</p>`;
    return;
  }

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

    ${settings.providers.map(providerCard).join('')}

    <section class="card">
      <h2>Verbindung testen</h2>
      <p class="hint">Schickt einen kleinen Auftrag an den gewählten Anbieter.</p>
      <button id="test">Testen</button>
      <p id="test-result"></p>
    </section>`;

  for (const radio of root.querySelectorAll<HTMLInputElement>('input[name="provider"]')) {
    radio.addEventListener('change', () => sendJSON('PUT', '/api/settings/provider', { provider: radio.value }));
  }

  for (const provider of settings.providers) {
    if (provider.loggedIn) loadModels(root, provider);
  }

  for (const button of root.querySelectorAll('[data-refresh]')) {
    button.addEventListener('click', () => renderSettings(root));
  }

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

function providerCard(provider: Provider): string {
  const content = provider.loggedIn
    ? `<label class="row">Modell
         <select id="model-${provider.id}" disabled><option>Lädt …</option></select>
       </label>`
    : `<p class="hint">Einmal auf dem Server im Ordner von Nugget Studio ausführen und den Anweisungen folgen:</p>
       <pre><code>${escapeHtml(LOGIN_COMMANDS[provider.id])}</code></pre>
       <button class="secondary" data-refresh>Status neu prüfen</button>`;
  return `
    <section class="card">
      <h2>${escapeHtml(provider.label)} ${badge(provider)}</h2>
      ${content}
    </section>`;
}

/** Füllt die Modellauswahl eines angemeldeten Anbieters und speichert Änderungen. */
async function loadModels(root: HTMLElement, provider: Provider) {
  const select = root.querySelector<HTMLSelectElement>(`#model-${provider.id}`)!;
  try {
    const models = await getJSON<ModelOption[]>(`/api/settings/models?provider=${provider.id}`);
    select.innerHTML = [{ id: '', label: 'Standard' }, ...models]
      .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === provider.model ? 'selected' : ''}>${escapeHtml(model.label)}</option>`)
      .join('');
    select.disabled = models.length === 0;
    select.addEventListener('change', () =>
      sendJSON('PUT', '/api/settings/model', { provider: provider.id, model: select.value }));
  } catch (error) {
    select.innerHTML = `<option>${escapeHtml((error as Error).message)}</option>`;
  }
}
