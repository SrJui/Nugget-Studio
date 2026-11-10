import { escapeHtml, getJSON } from '../helpers.ts';

type TopicCount = { id: string; name: string; published: number; open: number };

/** Grobes Ziel für eine Testphase von 4 Wochen (5 Facts pro Tag). */
const GOAL = 150;

export async function renderOverview(root: HTMLElement) {
  root.innerHTML = '<h1>Übersicht</h1><p>Lädt …</p>';
  try {
    const topics = await getJSON<TopicCount[]>('/api/overview');
    const total = topics.reduce((sum, topic) => sum + topic.published, 0);
    const open = topics.reduce((sum, topic) => sum + topic.open, 0);
    const rows = topics
      .map((topic) => `<tr><td>${escapeHtml(topic.name)}</td><td class="number">${topic.published}</td><td class="number">${topic.open}</td></tr>`)
      .join('');
    root.innerHTML = `
      <h1>Übersicht</h1>
      <p>${total} von etwa ${GOAL} Facts für eine Testphase von 4 Wochen sind freigegeben.
        ${open ? `<a href="#pruefen">${open} Entwürfe warten auf deine Prüfung.</a>` : ''}</p>
      <table>
        <thead><tr><th>Thema</th><th class="number">Freigegeben</th><th class="number">Offen</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th>Gesamt</th><th class="number">${total}</th><th class="number">${open}</th></tr></tfoot>
      </table>`;
  } catch (error) {
    root.innerHTML = `<h1>Übersicht</h1><p class="error">${escapeHtml((error as Error).message)}</p>`;
  }
}
