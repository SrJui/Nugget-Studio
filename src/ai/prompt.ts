import { encode } from '@toon-format/toon';

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

/** Daten für die KI im kompakten TOON-Format (spart Tokens gegenüber JSON). */
function asToon(facts: unknown[]): string {
  return `Die Daten sind im TOON-Format (wie JSON, Feldnamen stehen einmal im Kopf einer Liste):\n\n${encode({ facts })}`;
}

function avoidList(existingTitles: string[]): string {
  if (!existingTitles.length) return '';
  return `\n\nDiese Facts gibt es schon. Wähle andere Inhalte, auch keine ähnlichen:\n${existingTitles.map((t) => `- ${t}`).join('\n')}`;
}

export function generatePrompt(options: {
  topicName: string;
  count: number;
  existingTitles: string[];
}): string {
  return `${RULES}

Aufgabe: Schreibe ${options.count} neue Facts zum Thema „${options.topicName}“.
Die Facts sollen sich deutlich voneinander unterscheiden.${avoidList(options.existingTitles)}`;
}

/** Antwortformat der Prüf-KI: ein Urteil pro Fact, in derselben Reihenfolge. */
export const VERDICTS_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ok: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['ok', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdicts'],
  additionalProperties: false,
};

export type Verdict = { ok: boolean; reason: string };

/** Auftrag an die zweite KI: jeden Fact unabhängig prüfen. `notes` sind Hinweise der Code-Prüfung. */
export function verifyPrompt(facts: (GeneratedFact & { notes: string[] })[]): string {
  return `${RULES}

Du bist jetzt nicht der Autor, sondern die strenge Faktenprüfung. Eine andere KI hat die folgenden Facts
geschrieben. Prüfe jeden einzeln per Webrecherche:
- Stimmt jede Aussage in title, summary und body? Ist nichts übertrieben oder irreführend vereinfacht?
- Belegen die Quellen den Fact wirklich, und sind sie vertrauenswürdig?
- Ist der Fact verständlich und hält er die Regeln oben ein?

Setze ok nur auf true, wenn du den Fact ohne Bedenken veröffentlichen würdest. Im Zweifel false.
reason: ein bis zwei Sätze auf Deutsch – was du geprüft hast bzw. was falsch ist.
Gib genau ein Urteil pro Fact zurück, in derselben Reihenfolge.
notes enthält Hinweise der automatischen Prüfung (z. B. entfernte, nicht erreichbare Quellen).

${asToon(facts)}`;
}

export function shortenPrompt(facts: GeneratedFact[]): string {
  return `Diese Facts sind zu lang. Kürze bei jedem den title auf höchstens ${MAX_TITLE} Zeichen
und die summary auf höchstens ${MAX_SUMMARY} Zeichen. Inhalt, body und sources bleiben unverändert.
Gib alle Facts in derselben Reihenfolge zurück. Keine Webrecherche nötig.

${asToon(facts)}`;
}
