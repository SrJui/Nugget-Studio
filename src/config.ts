import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Alles Dauerhafte liegt hier: Datenbank und Anmeldungen der KI-CLIs. */
export const dataDir = resolve(process.env.DATA_DIR ?? 'data');

// Die KI-CLIs lesen diese Variablen. Ohne sie würde die Claude-CLI beim Entwickeln
// die persönliche Anmeldung unter ~/.claude benutzen.
process.env.CLAUDE_CONFIG_DIR ??= resolve(dataDir, 'claude');
process.env.CODEX_HOME ??= resolve(dataDir, 'codex');

/** Leerer Arbeitsordner für die KI-CLIs, damit sie keine Projektdateien sehen. */
export const aiWorkDir = resolve(dataDir, 'work');

for (const dir of [dataDir, process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME, aiWorkDir]) {
  mkdirSync(dir, { recursive: true });
}
