import { escapeHtml, getJSON, sendJSON } from '../helpers.ts';

type Topic = { id: string; name: string };
type Source = { title: string; url: string; ok?: boolean; status?: number };
type Draft = {
  id: number;
  topic_id: string;
  title: string;
  summary: string;
  body: string;
  sources: Source[];
  issues: string[];
};

const MAX_TITLE = 80;
const MAX_SUMMARY = 140;

type State = {
  root: HTMLElement;
  topics: Topic[];
  drafts: Draft[];
  index: number;
  mode: 'view' | 'edit' | 'regenerate' | 'busy';
  message?: string;
};

let state: State | undefined;

export async function renderReview(root: HTMLElement) {
  root.innerHTML = '<h1>Prüfen</h1><p>Lädt …</p>';
  try {
    const [topics, drafts] = await Promise.all([getJSON<Topic[]>('/api/topics'), getJSON<Draft[]>('/api/drafts')]);
    state = { root, topics, drafts, index: 0, mode: 'view' };
    draw();
  } catch (error) {
    root.innerHTML = `<h1>Prüfen</h1><p class="error">${escapeHtml((error as Error).message)}</p>`;
  }
}

// Tastenkürzel: einmal registriert, wirken nur, wenn die Prüf-Ansicht offen ist.
document.addEventListener('keydown', (event) => {
  if (!state || location.hash !== '#pruefen' || !state.root.isConnected) return;
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement;

  if (state.mode === 'edit' || state.mode === 'regenerate') {
    if (event.key === 'Escape') {
      state.mode = 'view';
      draw();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && state.mode === 'edit') {
      event.preventDefault();
      void saveEdit();
    }
    return;
  }
  if (typing || state.mode === 'busy' || event.metaKey || event.ctrlKey || event.altKey) return;

  const actions: Record<string, () => void> = {
    a: () => void publish(),
    e: () => setMode('edit'),
    r: () => void reject(),
    n: () => setMode('regenerate'),
    ArrowLeft: () => move(-1),
    ArrowRight: () => move(1),
  };
  const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (action && current()) {
    event.preventDefault();
    action();
  }
});

function current(): Draft | undefined {
  return state?.drafts[state.index];
}

function topicName(id: string): string {
  return state?.topics.find((topic) => topic.id === id)?.name ?? id;
}

function setMode(mode: State['mode'], message?: string) {
  state!.mode = mode;
  state!.message = message;
  draw();
}

function move(step: number) {
  const s = state!;
  s.index = Math.min(Math.max(s.index + step, 0), s.drafts.length - 1);
  s.message = undefined;
  draw();
}

/** Entfernt den aktuellen Entwurf aus der Liste und zeigt den nächsten. */
function removeCurrent(message: string) {
  const s = state!;
  s.drafts.splice(s.index, 1);
  s.index = Math.min(s.index, Math.max(s.drafts.length - 1, 0));
  setMode('view', message);
}

/** Führt eine Server-Aktion aus und zeigt währenddessen „Läuft …“. */
async function act(label: string, action: () => Promise<void>) {
  setMode('busy', label);
  try {
    await action();
  } catch (error) {
    setMode('view', `Fehler: ${(error as Error).message}`);
  }
}

function publish() {
  const draft = current()!;
  return act('Wird freigegeben …', async () => {
    await sendJSON('POST', `/api/drafts/${draft.id}/publish`);
    removeCurrent(`„${draft.title}“ freigegeben.`);
  });
}

function reject() {
  const draft = current()!;
  return act('Wird abgelehnt …', async () => {
    await sendJSON('DELETE', `/api/drafts/${draft.id}`);
    removeCurrent(`„${draft.title}“ abgelehnt.`);
  });
}

function regenerate(hint: string) {
  const draft = current()!;
  return act('Wird neu erzeugt … (kann 1–2 Minuten dauern)', async () => {
    state!.drafts[state!.index] = await sendJSON<Draft>('POST', `/api/drafts/${draft.id}/regenerate`, { hint });
    setMode('view', 'Neu erzeugt.');
  });
}

function saveEdit() {
  const draft = current()!;
  const form = state!.root.querySelector<HTMLFormElement>('#edit-form')!;
  const data = new FormData(form);
  const titles = data.getAll('source_title') as string[];
  const urls = data.getAll('source_url') as string[];
  return act('Wird gespeichert und geprüft …', async () => {
    state!.drafts[state!.index] = await sendJSON<Draft>('PUT', `/api/drafts/${draft.id}`, {
      topic_id: data.get('topic_id'),
      title: data.get('title'),
      summary: data.get('summary'),
      body: data.get('body'),
      sources: titles.map((title, i) => ({ title, url: urls[i] })),
    });
    setMode('view', 'Gespeichert.');
  });
}

// --- Darstellung ---

function draw() {
  const s = state!;
  const draft = current();
  const message = s.message
    ? `<p class="${s.message.startsWith('Fehler') ? 'error' : 'hint'}">${escapeHtml(s.message)}</p>`
    : '';

  if (!draft) {
    s.root.innerHTML = `<h1>Prüfen</h1>${message}<p>Keine offenen Entwürfe. <a href="#erzeugen">Neue erzeugen</a></p>`;
    return;
  }

  const header = `
    <div class="row review-header">
      <h1>Prüfen</h1>
      <span class="hint">${s.index + 1} / ${s.drafts.length} · ${escapeHtml(topicName(draft.topic_id))}</span>
    </div>${message}`;

  if (s.mode === 'edit') {
    s.root.innerHTML = header + editForm(draft);
    wireEditForm();
    return;
  }

  s.root.innerHTML = `${header}
    ${draft.issues.length ? `<ul class="issues">${draft.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : ''}
    <div class="widget">
      <strong>${escapeHtml(draft.title)}</strong>
      <p>${escapeHtml(draft.summary)}</p>
    </div>
    <div class="body">${draft.body.split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p)}</p>`).join('')}</div>
    <h3>Quellen</h3>
    <ul class="sources">
      ${draft.sources.map((source) => `
        <li class="${source.ok ? 'ok' : 'bad'}">${source.ok ? '✓' : '✗'}
          <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>
          ${source.status && !source.ok ? `<span class="hint">(${source.status})</span>` : ''}
        </li>`).join('')}
    </ul>
    ${s.mode === 'regenerate'
      ? `<form id="regenerate-form" class="row">
           <input name="hint" placeholder="Was soll besser werden? (Enter = los, Esc = abbrechen)" autocomplete="off">
           <button>Neu erzeugen</button>
         </form>`
      : `<div class="actions">
           <button data-action="publish" ${s.mode === 'busy' ? 'disabled' : ''}><kbd>A</kbd> Freigeben</button>
           <button data-action="edit" class="secondary" ${s.mode === 'busy' ? 'disabled' : ''}><kbd>E</kbd> Bearbeiten</button>
           <button data-action="regenerate" class="secondary" ${s.mode === 'busy' ? 'disabled' : ''}><kbd>N</kbd> Neu erzeugen</button>
           <button data-action="reject" class="secondary danger" ${s.mode === 'busy' ? 'disabled' : ''}><kbd>R</kbd> Ablehnen</button>
           <span class="hint"><kbd>←</kbd> <kbd>→</kbd> blättern</span>
         </div>`}`;

  const buttons: Record<string, () => void> = {
    publish: () => void publish(),
    edit: () => setMode('edit'),
    regenerate: () => setMode('regenerate'),
    reject: () => void reject(),
  };
  for (const button of s.root.querySelectorAll<HTMLButtonElement>('[data-action]')) {
    button.addEventListener('click', buttons[button.dataset.action!]);
  }

  const regenerateForm = s.root.querySelector<HTMLFormElement>('#regenerate-form');
  if (regenerateForm) {
    const input = regenerateForm.querySelector('input')!;
    input.focus();
    regenerateForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void regenerate(input.value);
    });
  }
}

function editForm(draft: Draft): string {
  const sourceRow = (source: Source) => `
    <div class="row source-row">
      <input name="source_title" value="${escapeHtml(source.title)}" placeholder="Name der Quelle">
      <input name="source_url" value="${escapeHtml(source.url)}" placeholder="https://…">
      <button type="button" class="secondary" data-remove-source>✕</button>
    </div>`;

  return `
    <form id="edit-form" class="edit">
      <label>Thema
        <select name="topic_id">
          ${state!.topics.map((topic) => `<option value="${escapeHtml(topic.id)}" ${topic.id === draft.topic_id ? 'selected' : ''}>${escapeHtml(topic.name)}</option>`).join('')}
        </select>
      </label>
      <label>Titel <span class="counter" data-for="title" data-max="${MAX_TITLE}"></span>
        <input name="title" value="${escapeHtml(draft.title)}" class="wide">
      </label>
      <label>Summary (Widget) <span class="counter" data-for="summary" data-max="${MAX_SUMMARY}"></span>
        <textarea name="summary" rows="2" class="wide">${escapeHtml(draft.summary)}</textarea>
      </label>
      <label>Text
        <textarea name="body" rows="12" class="wide">${escapeHtml(draft.body)}</textarea>
      </label>
      <fieldset>
        <legend>Quellen <button type="button" class="link" id="add-source">+ hinzufügen</button></legend>
        <div id="source-rows">${draft.sources.map(sourceRow).join('')}</div>
        <template id="source-template">${sourceRow({ title: '', url: '' })}</template>
      </fieldset>
      <p>
        <button>Speichern <kbd>⌘ Enter</kbd></button>
        <button type="button" class="secondary" id="cancel-edit">Abbrechen <kbd>Esc</kbd></button>
      </p>
    </form>`;
}

function wireEditForm() {
  const form = state!.root.querySelector<HTMLFormElement>('#edit-form')!;

  // Zeichenzähler für Titel und Summary
  const updateCounters = () => {
    for (const counter of form.querySelectorAll<HTMLElement>('.counter')) {
      const field = form.elements.namedItem(counter.dataset.for!) as HTMLInputElement;
      const max = Number(counter.dataset.max);
      counter.textContent = `${field.value.length}/${max}`;
      counter.classList.toggle('error', field.value.length > max);
    }
  };
  form.addEventListener('input', updateCounters);
  updateCounters();

  const rows = form.querySelector('#source-rows')!;
  form.querySelector('#add-source')!.addEventListener('click', () => {
    rows.append(form.querySelector<HTMLTemplateElement>('#source-template')!.content.cloneNode(true));
  });
  rows.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('[data-remove-source]');
    button?.closest('.source-row')?.remove();
  });

  form.querySelector('#cancel-edit')!.addEventListener('click', () => setMode('view'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveEdit();
  });
  form.querySelector<HTMLInputElement>('input[name="title"]')!.focus();
}
