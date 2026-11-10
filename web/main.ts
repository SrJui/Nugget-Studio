import { renderGenerate } from './views/generate.ts';
import { renderOverview } from './views/overview.ts';
import { renderReview } from './views/review.ts';
import { renderSettings } from './views/settings.ts';

type View = (root: HTMLElement) => void;

const views: Record<string, View> = {
  erzeugen: renderGenerate,
  pruefen: renderReview,
  uebersicht: renderOverview,
  einstellungen: renderSettings,
};

function render() {
  const name = location.hash.slice(1) in views ? location.hash.slice(1) : 'erzeugen';
  for (const link of document.querySelectorAll('nav a')) {
    link.classList.toggle('active', link.getAttribute('href') === `#${name}`);
  }
  views[name](document.getElementById('view')!);
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
