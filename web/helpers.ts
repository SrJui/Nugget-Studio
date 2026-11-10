/** Lädt JSON vom Server. Bei Fehlern wird die Meldung des Servers geworfen. */
export function getJSON<T>(path: string): Promise<T> {
  return sendJSON<T>('GET', path);
}

/** Schickt eine Anfrage mit optionalem JSON-Inhalt an den Server. */
export async function sendJSON<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Fehler ${response.status}`);
  return result as T;
}

/** Macht Text sicher zum Einfügen in HTML. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
