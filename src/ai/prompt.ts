/** Längengrenzen aus der Supabase-Tabelle `facts`. */
export const MAX_TITLE = 80;
export const MAX_SUMMARY = 140;

export type Source = { title: string; url: string };
export type GeneratedFact = { title: string; summary: string; body: string; sources: Source[] };

const FACT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    body: { type: 'string' },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, url: { type: 'string' } },
        required: ['title', 'url'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'summary', 'body', 'sources'],
  additionalProperties: false,
};

/** Antwortformat: immer eine Liste von Facts, auch wenn nur einer gewünscht ist. */
export const FACTS_SCHEMA = {
  type: 'object',
  properties: { facts: { type: 'array', items: FACT_SCHEMA } },
  required: ['facts'],
  additionalProperties: false,
};

const RULES = `
Du schreibst Wissens-Facts für die iPhone-App „Nugget“. Nutzer sehen jeden Tag kurze, überraschende
Facts in einem Homescreen-Widget und können in der App eine ausführlichere Erklärung lesen.

Regeln für jeden Fact:
- Sprache: Deutsch, verständlich ohne Vorwissen.
- title: höchstens ${MAX_TITLE} Zeichen. Macht neugierig, ist aber nicht reißerisch.
- summary: höchstens ${MAX_SUMMARY} Zeichen. Steht allein im Widget und muss ohne Titel verständlich sein.
- body: ein kurzer Blogbeitrag mit 2–4 Absätzen. Ordnet ein und erklärt Hintergründe.
  Absätze durch eine Leerzeile trennen. Kein Markdown, keine Überschriften.
- Sachlich korrekt. Keine Übertreibung und keine irreführende Vereinfachung.
  Lieber „vermutlich“ oder „nach heutigem Stand“ als falsche Sicherheit.
- sources: mindestens eine vertrauenswürdige Quelle (Fachseiten, Museen, Universitäten,
  seriöse Medien; Wikipedia nur ergänzend). Nur echte URLs, die du per Webrecherche geprüft hast.
- Prüfe jeden Fact per Webrecherche, bevor du ihn aufnimmst.
`.trim();

function avoidList(existingTitles: string[]): string {
  if (!existingTitles.length) return '';
  return `\n\nDiese Facts gibt es schon. Wähle andere Inhalte, auch keine ähnlichen:\n${existingTitles.map((t) => `- ${t}`).join('\n')}`;
}

export function generatePrompt(options: {
  topicName: string;
  count: number;
  direction: string;
  existingTitles: string[];
}): string {
  const direction = options.direction ? `\nRichtung: ${options.direction}` : '';
  return `${RULES}

Aufgabe: Schreibe ${options.count} neue Facts zum Thema „${options.topicName}“.${direction}
Die Facts sollen sich deutlich voneinander unterscheiden.${avoidList(options.existingTitles)}`;
}

export function regeneratePrompt(options: {
  topicName: string;
  previous: GeneratedFact;
  hint: string;
  existingTitles: string[];
}): string {
  return `${RULES}

Aufgabe: Überarbeite diesen Fact zum Thema „${options.topicName}“ und gib genau einen Fact zurück.
Hinweis der Redaktion: ${options.hint || 'Bitte einen besseren Fact zum selben Thema schreiben.'}

Bisherige Fassung:
${JSON.stringify(options.previous, null, 2)}${avoidList(options.existingTitles)}`;
}

export function shortenPrompt(facts: GeneratedFact[]): string {
  return `Diese Facts sind zu lang. Kürze bei jedem den title auf höchstens ${MAX_TITLE} Zeichen
und die summary auf höchstens ${MAX_SUMMARY} Zeichen. Inhalt, body und sources bleiben unverändert.
Gib alle Facts in derselben Reihenfolge zurück. Keine Webrecherche nötig.

${JSON.stringify(facts, null, 2)}`;
}
