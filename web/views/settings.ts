import { escapeHtml, getJSON, sendJSON } from '../helpers.ts';

type ProviderId = 'claude' | 'codex';
type Provider = { id: ProviderId; label: string; loggedIn: boolean; detail?: string; model: string };
type Role = 'writer' | 'checker';
type Settings = { roles: Record<Role, ProviderId>; providers: Provider[] };
type ModelOption = { id: string; label: string };
type TestResult = { role: Role; provider: string; ok: boolean; seconds?: number; error?: string };

const ROLE_TEXT: Record<Role, string> = { writer: 'Schreiben mit', checker: 'Prüfen mit' };

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
      <h2>Zwei KIs</h2>
      <p class="hint">Die erste schreibt die Facts, die zweite prüft sie. Am besten zwei verschiedene Anbieter.</p>
      <div class="roles">
        ${(Object.keys(ROLE_TEXT) as Role[]).map((role) => `
          <fieldset>
            <legend>${ROLE_TEXT[role]}</legend>
            ${settings.providers.map((provider) => `
              <label class="choice">
                <input type="radio" name="${role}" value="${provider.id}" ${provider.id === settings.roles[role] ? 'checked' : ''}>
                ${escapeHtml(provider.label)} ${badge(provider)}
              </label>`).join('')}
          </fieldset>`).join('')}
      </div>
      <p id="same-provider" class="hint warn-text">Beide nutzen denselben Anbieter – die Prüfung ist dann weniger unabhängig.</p>
    </section>

    ${settings.providers.map(providerCard).join('')}

    <section class="card">
      <h2>Verbindung testen</h2>
      <p class="hint">Schickt beiden KIs einen kleinen Auftrag.</p>
      <button id="test">Testen</button>
      <ul id="test-result" class="plain"></ul>
    </section>`;

  const sameHint = root.querySelector<HTMLElement>('#same-provider')!;
  const updateSameHint = () => {
    const chosen = (role: Role) => root.querySelector<HTMLInputElement>(`input[name="${role}"]:checked`)?.value;
    sameHint.hidden = chosen('writer') !== chosen('checker');
  };
  updateSameHint();

  for (const radio of root.querySelectorAll<HTMLInputElement>('.roles input[type="radio"]')) {
    radio.addEventListener('change', () => {
      updateSameHint();
      void sendJSON('PUT', '/api/settings/provider', { role: radio.name, provider: radio.value });
    });
  }

  for (const provider of settings.providers) {
    if (provider.loggedIn) loadModels(root, provider);
  }

  for (const button of root.querySelectorAll('[data-refresh]')) {
    button.addEventListener('click', () => renderSettings(root));
  }

  root.querySelector('#test')!.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const output = root.querySelector('#test-result')!;
    button.disabled = true;
    output.innerHTML = '<li class="hint">Läuft … (kann bis zu einer Minute dauern)</li>';
    try {
      const results = await sendJSON<TestResult[]>('POST', '/api/settings/test');
      output.innerHTML = results.map((r) => `
        <li class="${r.ok ? '' : 'error'}">${r.ok ? '✓' : '✗'} ${ROLE_TEXT[r.role]} ${escapeHtml(r.provider)}:
          ${r.ok ? `antwortet (${r.seconds} s)` : escapeHtml(r.error ?? 'Fehler')}</li>`).join('');
    } catch (error) {
      output.innerHTML = `<li class="error">${escapeHtml((error as Error).message)}</li>`;
    } finally {
      button.disabled = false;
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
