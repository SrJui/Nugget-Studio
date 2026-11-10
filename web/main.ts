import { renderOverview } from './views/overview.ts';

type View = (root: HTMLElement) => void;

const placeholder = (title: string): View => (root) => {
  root.innerHTML = `<h1>${title}</h1><p>Kommt in einer der nächsten Etappen.</p>`;
};

const views: Record<string, View> = {
  erzeugen: placeholder('Erzeugen'),
  pruefen: placeholder('Prüfen'),
  uebersicht: renderOverview,
  einstellungen: placeholder('Einstellungen'),
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
