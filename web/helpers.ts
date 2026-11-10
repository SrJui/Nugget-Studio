/** Lädt JSON vom Server. Bei Fehlern wird die Meldung des Servers geworfen. */
export async function getJSON<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Fehler ${response.status}`);
  return body as T;
}

/** Macht Text sicher zum Einfügen in HTML. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
