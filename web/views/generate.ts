import { escapeHtml, getJSON, sendJSON } from '../helpers.ts';

type Topic = { id: string; name: string };
type Job = {
  id: number;
  count: number;
  topics: string[];
  direction: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  created: number;
  error: string | null;
};

const STATUS_TEXT: Record<Job['status'], string> = {
  running: 'läuft',
  done: 'fertig',
  failed: 'Fehler',
  cancelled: 'abgebrochen',
};

export async function renderGenerate(root: HTMLElement) {
  root.innerHTML = '<h1>Erzeugen</h1><p>Lädt …</p>';
  let topics: Topic[];
  try {
    topics = await getJSON<Topic[]>('/api/topics');
  } catch (error) {
    root.innerHTML = `<h1>Erzeugen</h1><p class="error">${escapeHtml((error as Error).message)}</p>`;
    return;
  }

  root.innerHTML = `
    <h1>Erzeugen</h1>
    <form id="generate-form" class="card">
      <h2>Neuer Auftrag</h2>
      <label class="row">Anzahl <input type="number" name="count" min="1" max="200" value="20" required></label>
      <fieldset>
        <legend>Themen
          <button type="button" class="link" data-select="all">alle</button>
          <button type="button" class="link" data-select="none">keine</button>
        </legend>
        <div class="topics">
          ${topics.map((topic) => `
            <label><input type="checkbox" name="topics" value="${escapeHtml(topic.id)}" checked> ${escapeHtml(topic.name)}</label>`).join('')}
        </div>
      </fieldset>
      <label>Richtung (optional)
        <input type="text" name="direction" placeholder="z. B. überraschende Fakten über das Mittelalter" class="wide">
      </label>
      <p><button>Erzeugen starten</button> <span id="form-error" class="error"></span></p>
    </form>
    <section class="card">
      <h2>Letzte Aufträge</h2>
      <div id="jobs"></div>
    </section>`;

  const form = root.querySelector<HTMLFormElement>('#generate-form')!;
  const checkboxes = [...form.querySelectorAll<HTMLInputElement>('input[name="topics"]')];

  for (const button of form.querySelectorAll<HTMLButtonElement>('[data-select]')) {
    button.addEventListener('click', () => {
      for (const box of checkboxes) box.checked = button.dataset.select === 'all';
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const error = root.querySelector('#form-error')!;
    error.textContent = '';
    try {
      await sendJSON('POST', '/api/jobs', {
        count: Number(data.get('count')),
        topics: data.getAll('topics'),
        direction: data.get('direction'),
      });
      await showJobs(root, topics);
    } catch (e) {
      error.textContent = (e as Error).message;
    }
  });

  await showJobs(root, topics);
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Zeigt die letzten Aufträge und aktualisiert sie, solange einer läuft. */
async function showJobs(root: HTMLElement, topics: Topic[]) {
  clearTimeout(refreshTimer);
  const box = root.querySelector('#jobs');
  if (!box || !box.isConnected) return; // Seite wurde inzwischen gewechselt

  const jobs = await getJSON<Job[]>('/api/jobs');
  const names = new Map(topics.map((topic) => [topic.id, topic.name]));
  box.innerHTML = jobs.length
    ? jobs.map((job) => `
        <div class="job">
          <div class="row">
            <strong>${job.created} / ${job.count}</strong>
            <span class="badge ${job.status === 'done' ? 'ok' : ''}">${STATUS_TEXT[job.status]}</span>
            <span class="hint">${escapeHtml(job.topics.map((id) => names.get(id) ?? id).join(', '))}</span>
            ${job.status === 'running' ? `<button class="secondary" data-cancel="${job.id}">Abbrechen</button>` : ''}
          </div>
          <progress max="${job.count}" value="${job.created}"></progress>
          ${job.direction ? `<p class="hint">Richtung: ${escapeHtml(job.direction)}</p>` : ''}
          ${job.error ? `<p class="error">${escapeHtml(job.error)}</p>` : ''}
        </div>`).join('')
    : '<p class="hint">Noch keine Aufträge.</p>';

  for (const button of box.querySelectorAll<HTMLButtonElement>('[data-cancel]')) {
    button.addEventListener('click', async () => {
      await sendJSON('POST', `/api/jobs/${button.dataset.cancel}/cancel`);
      await showJobs(root, topics);
    });
  }

  if (jobs.some((job) => job.status === 'running')) {
    refreshTimer = setTimeout(() => showJobs(root, topics), 3000);
  }
}
