import { renderGenerate } from './views/generate.ts';
import { renderPublish } from './views/publish.ts';
import { renderSettings } from './views/settings.ts';

/** `param` ist der Teil nach dem Schrägstrich, z. B. die ID in `#veroeffentlichen/12`. */
type View = (root: HTMLElement, param?: string) => void;

const views: Record<string, View> = {
  erzeugen: renderGenerate,
  veroeffentlichen: renderPublish,
  einstellungen: renderSettings,
};

function render() {
  const [hashName, param] = location.hash.slice(1).split('/');
  const name = hashName in views ? hashName : 'erzeugen';
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle('active', link.getAttribute('href') === `#${name}`);
  }
  views[name](document.getElementById('view')!, param);
}

async function showServerStatus() {
  const status = document.getElementById('status')!;
  try {
    const response = await fetch('/api/health');
    status.textContent = response.ok ? 'Server verbunden' : 'Server-Fehler';
  } catch {
    status.textContent = 'Server nicht erreichbar';
  }
}

window.addEventListener('hashchange', render);
render();
showServerStatus();
