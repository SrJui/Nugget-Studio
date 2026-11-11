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
  review: string | null;
};

const MAX_TITLE = 80;
const MAX_SUMMARY = 140;
const LIST_HASH = '#veroeffentlichen';

/** Kurze Rückmeldung, die nach dem nächsten Zeichnen einmal angezeigt wird. */
let flash: { text: string; error?: boolean } | undefined;

let topics: Topic[] = [];

export async function renderPublish(root: HTMLElement, param?: string) {
  root.innerHTML = '<h1>Veröffentlichen</h1><p class="hint">Lädt …</p>';
  try {
    const [loadedTopics, drafts] = await Promise.all([getJSON<Topic[]>('/api/topics'), getJSON<Draft[]>('/api/drafts')]);
    topics = loadedTopics;
    const draft = param ? drafts.find((d) => d.id === Number(param)) : undefined;
    if (draft) drawDetail(root, draft);
    else drawList(root, drafts);
  } catch (error) {
    root.innerHTML = `<h1>Veröffentlichen</h1><p class="error">${escapeHtml((error as Error).message)}</p>`;
  }
}

// Esc: aus dem Bearbeiten zurück zum Detail, aus dem Detail zurück zur Liste.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !location.hash.startsWith(`${LIST_HASH}/`)) return;
  const cancel = document.querySelector<HTMLButtonElement>('#cancel-edit');
  if (cancel) cancel.click();
  else location.hash = LIST_HASH;
});

function topicName(id: string): string {
  return topics.find((topic) => topic.id === id)?.name ?? id;
}

function takeFlash(): string {
  const message = flash ? `<p class="flash ${flash.error ? 'error' : ''}">${escapeHtml(flash.text)}</p>` : '';
  flash = undefined;
  return message;
}

/** Kleine Kennzeichen: nicht von KI geprüft, Hinweise der Code-Prüfung. */
function tags(draft: Draft): string {
  return [
    draft.review === null ? '<span class="badge warn">nicht von KI geprüft</span>' : '',
    draft.issues.length ? `<span class="badge warn">${draft.issues.length} Hinweis${draft.issues.length > 1 ? 'e' : ''}</span>` : '',
  ].join('');
}

// --- Liste ---

function drawList(root: HTMLElement, drafts: Draft[]) {
  const header = (count: number) => count === 1 ? '1 Fact bereit' : `${count} Facts bereit`;

  root.innerHTML = `
    <div class="page-header">
      <h1>Veröffentlichen</h1>
      ${drafts.length ? '<button id="publish-all">Alle veröffentlichen</button>' : ''}
    </div>
    <p id="count" class="hint">${header(drafts.length)}</p>
    <div id="message">${takeFlash()}</div>
    ${drafts.length
      ? `<ul class="facts">${drafts.map((draft) => `
          <li class="fact" data-id="${draft.id}">
            <a class="fact-link" href="${LIST_HASH}/${draft.id}">
              <span class="fact-meta">${escapeHtml(topicName(draft.topic_id))} ${tags(draft)}</span>
              <strong>${escapeHtml(draft.title)}</strong>
              <span class="fact-summary">${escapeHtml(draft.summary)}</span>
            </a>
            <button class="secondary" data-publish="${draft.id}">Veröffentlichen</button>
          </li>`).join('')}</ul>`
      : '<p class="empty">Nichts zu tun. <a href="#erzeugen">Neue Facts erzeugen</a></p>'}`;

  const message = root.querySelector('#message')!;
  const showError = (error: unknown) => {
    message.innerHTML = `<p class="flash error">${escapeHtml((error as Error).message)}</p>`;
  };

  root.querySelector('.facts')?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-publish]');
    if (!button) return;
    button.disabled = true;
    button.textContent = 'Läuft …';
    try {
      await sendJSON('POST', `/api/drafts/${button.dataset.publish}/publish`);
      removeRow(button.closest<HTMLElement>('.fact')!, () => {
        const left = root.querySelectorAll('.fact').length;
        if (!left) void renderPublish(root);
        else root.querySelector('#count')!.textContent = header(left);
      });
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Veröffentlichen';
      showError(error);
    }
  });

  root.querySelector<HTMLButtonElement>('#publish-all')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!confirm(`${header(drafts.length).replace(' bereit', '')} veröffentlichen?`)) return;
    button.disabled = true;
    button.textContent = 'Wird veröffentlicht …';
    try {
      const result = await sendJSON<{ published: number; errors: string[] }>('POST', '/api/drafts/publish-all');
      const errors = result.errors.length ? ` Nicht veröffentlicht: ${result.errors.join(' · ')}` : '';
      flash = { text: `${result.published} veröffentlicht.${errors}`, error: result.errors.length > 0 };
      void renderPublish(root);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Alle veröffentlichen';
      showError(error);
    }
  });
}

/** Blendet eine Zeile kurz aus und entfernt sie dann. */
function removeRow(row: HTMLElement, done: () => void) {
  row.classList.add('leaving');
  setTimeout(() => {
    row.remove();
    done();
  }, 200);
}

// --- Detail ---

function drawDetail(root: HTMLElement, draft: Draft) {
  root.innerHTML = `
    <a class="back" href="${LIST_HASH}">← Zurück</a>
    <p class="fact-meta">${escapeHtml(topicName(draft.topic_id))} ${tags(draft)}</p>
    <div id="message">${takeFlash()}</div>
    ${draft.review ? `<div class="note"><strong>Prüf-KI:</strong> ${escapeHtml(draft.review)}</div>` : ''}
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
    <div class="actions">
      <button data-action="publish">Veröffentlichen</button>
      <button data-action="edit" class="secondary">Bearbeiten</button>
      <button data-action="reject" class="secondary danger">Ablehnen</button>
    </div>`;

  const run = async (button: HTMLButtonElement, label: string, action: () => Promise<void>) => {
    for (const b of root.querySelectorAll<HTMLButtonElement>('.actions button')) b.disabled = true;
    button.textContent = label;
    try {
      await action();
    } catch (error) {
      flash = { text: (error as Error).message, error: true };
      drawDetail(root, draft);
    }
  };

  const actions: Record<string, (button: HTMLButtonElement) => void> = {
    publish: (button) => run(button, 'Läuft …', async () => {
      await sendJSON('POST', `/api/drafts/${draft.id}/publish`);
      flash = { text: `„${draft.title}“ veröffentlicht.` };
      location.hash = LIST_HASH;
    }),
    reject: (button) => run(button, 'Läuft …', async () => {
      await sendJSON('DELETE', `/api/drafts/${draft.id}`);
      flash = { text: `„${draft.title}“ abgelehnt.` };
      location.hash = LIST_HASH;
    }),
    edit: () => drawEdit(root, draft),
  };
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-action]')) {
    button.addEventListener('click', () => actions[button.dataset.action!](button));
  }
}

// --- Bearbeiten ---

function sourceRow(source: Source): string {
  return `
    <div class="row source-row">
      <input name="source_title" value="${escapeHtml(source.title)}" placeholder="Name der Quelle">
      <input name="source_url" value="${escapeHtml(source.url)}" placeholder="https://…">
      <button type="button" class="secondary" data-remove-source aria-label="Quelle entfernen">✕</button>
    </div>`;
}

function drawEdit(root: HTMLElement, draft: Draft) {
  root.innerHTML = `
    <a class="back" href="${LIST_HASH}">← Zurück</a>
    <h1>Bearbeiten</h1>
    <div id="message">${takeFlash()}</div>
    <form id="edit-form" class="edit">
      <label>Thema
        <select name="topic_id">
          ${topics.map((topic) => `<option value="${escapeHtml(topic.id)}" ${topic.id === draft.topic_id ? 'selected' : ''}>${escapeHtml(topic.name)}</option>`).join('')}
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
      </fieldset>
      <div class="actions">
        <button>Speichern</button>
        <button type="button" class="secondary" id="cancel-edit">Abbrechen</button>
      </div>
    </form>`;

  const form = root.querySelector<HTMLFormElement>('#edit-form')!;

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
    rows.insertAdjacentHTML('beforeend', sourceRow({ title: '', url: '' }));
  });
  rows.addEventListener('click', (event) => {
    (event.target as HTMLElement).closest('[data-remove-source]')?.closest('.source-row')?.remove();
  });

  form.querySelector('#cancel-edit')!.addEventListener('click', () => drawDetail(root, draft));
  form.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) form.requestSubmit();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const titles = data.getAll('source_title') as string[];
    const urls = data.getAll('source_url') as string[];
    const save = form.querySelector<HTMLButtonElement>('button:not([type])')!;
    save.disabled = true;
    save.textContent = 'Wird gespeichert …';
    try {
      const updated = await sendJSON<Draft>('PUT', `/api/drafts/${draft.id}`, {
        topic_id: data.get('topic_id'),
        title: data.get('title'),
        summary: data.get('summary'),
        body: data.get('body'),
        sources: titles.map((title, i) => ({ title, url: urls[i] })),
      });
      flash = { text: 'Gespeichert.' };
      drawDetail(root, updated);
    } catch (error) {
      save.disabled = false;
      save.textContent = 'Speichern';
      root.querySelector('#message')!.innerHTML = `<p class="flash error">${escapeHtml((error as Error).message)}</p>`;
    }
  });
  form.querySelector<HTMLInputElement>('input[name="title"]')!.focus();
}
