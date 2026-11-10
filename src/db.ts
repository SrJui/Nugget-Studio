import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { dataDir } from './config.ts';

export const db = new DatabaseSync(resolve(dataDir, 'studio.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value as string | undefined;
}

export function setSetting(key: string, value: string) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function deleteSetting(key: string) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
