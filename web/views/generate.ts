import { escapeHtml, getJSON, sendJSON } from '../helpers.ts';

type Job = {
  id: number;
  count: number;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  created: number;
  rejected: number;
  error: string | null;
};
type Stats = { published: number; ready: number };

const STATUS_TEXT: Record<Job['status'], string> = {
  running: 'läuft',
  done: 'fertig',
  failed: 'Fehler',
  cancelled: 'abgebrochen',
};

export function renderGenerate(root: HTMLElement) {
  root.innerHTML = `
    <h1>Erzeugen</h1>
    <p id="stats" class="hint">&nbsp;</p>
    <form id="generate-form" class="generate">
      <label for="count">Wie viele Facts?</label>
      <div class="row">
        <input id="count" name="count" type="number" min="1" max="200" value="10" required>
        <button>Erzeugen</button>
      </div>
      <p class="hint">Verteilt auf alle Themen. Eine zweite KI prüft jeden Fact – nur bestandene landen bei
        <a href="#veroeffentlichen">Veröffentlichen</a>.</p>
      <p id="form-error" class="error"></p>
    </form>
    <h2>Aufträge</h2>
    <ul id="jobs" class="jobs"></ul>`;

  const form = root.querySelector<HTMLFormElement>('#generate-form')!;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = root.querySelector('#form-error')!;
    error.textContent = '';
    try {
      await sendJSON('POST', '/api/jobs', { count: Number(new FormData(form).get('count')) });
      await refresh(root);
    } catch (e) {
      error.textContent = (e as Error).message;
    }
  });

  root.querySelector('#jobs')!.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-cancel]');
    if (!button) return;
    button.disabled = true;
    await sendJSON('POST', `/api/jobs/${button.dataset.cancel}/cancel`);
    await refresh(root);
  });

  void refresh(root);
}

let refreshTimer: ReturnType<typeof setTimeout> | undefined;

/** Lädt Zahlen und Aufträge neu, solange ein Auftrag läuft alle 3 Sekunden. */
async function refresh(root: HTMLElement) {
  clearTimeout(refreshTimer);
  const list = root.querySelector<HTMLElement>('#jobs');
  if (!list?.isConnected) return; // Seite wurde inzwischen gewechselt

  try {
    const [jobs, stats] = await Promise.all([getJSON<Job[]>('/api/jobs'), getJSON<Stats>('/api/stats')]);
    root.querySelector('#stats')!.innerHTML =
      `${stats.published} veröffentlicht · <a href="#veroeffentlichen">${stats.ready} bereit</a>`;
    drawJobs(list, jobs);
    if (jobs.some((job) => job.status === 'running')) refreshTimer = setTimeout(() => refresh(root), 3000);
  } catch (error) {
    root.querySelector('#stats')!.innerHTML = `<span class="error">${escapeHtml((error as Error).message)}</span>`;
  }
}

/** Legt fehlende Zeilen an und aktualisiert vorhandene, damit der Fortschrittsbalken weich weiterläuft. */
function drawJobs(list: HTMLElement, jobs: Job[]) {
  if (!jobs.length) {
    list.innerHTML = '<li class="hint">Noch keine Aufträge.</li>';
    return;
  }
  const ids = jobs.map((job) => String(job.id));
  const shown = [...list.querySelectorAll<HTMLElement>('[data-job]')].map((row) => row.dataset.job);
  if (ids.join() !== shown.join()) {
    list.innerHTML = jobs.map((job) => `
      <li class="job" data-job="${job.id}">
        <div class="row">
          <strong data-field="progress"></strong>
          <span class="badge" data-field="status"></span>
          <button type="button" class="secondary small" data-cancel="${job.id}">Abbrechen</button>
        </div>
        <div class="bar"><span></span></div>
        <p class="error" data-field="error"></p>
      </li>`).join('');
  }

  for (const job of jobs) {
    const row = list.querySelector<HTMLElement>(`[data-job="${job.id}"]`)!;
    const rejected = job.rejected ? ` · ${job.rejected} verworfen` : '';
    row.querySelector('[data-field="progress"]')!.textContent = `${job.created} / ${job.count} geprüft${rejected}`;
    const badge = row.querySelector<HTMLElement>('[data-field="status"]')!;
    badge.textContent = STATUS_TEXT[job.status];
    badge.className = `badge ${job.status}`;
    row.querySelector<HTMLElement>('.bar span')!.style.transform = `scaleX(${Math.min(job.created / job.count, 1)})`;
    row.querySelector<HTMLElement>('[data-cancel]')!.hidden = job.status !== 'running';
    row.querySelector('[data-field="error"]')!.textContent = job.error ?? '';
  }
}
