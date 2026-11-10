import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { aiWorkDir } from '../config.ts';
import type { AiProvider } from './provider.ts';

/**
 * ChatGPT-Abo über die Codex-CLI. Nutzt den Login aus `codex login --device-auth`
 * (im Container: `docker compose exec -it studio codex login --device-auth`).
 */

const codexCli = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');

/** Einstellungen für jeden Aufruf: nur ChatGPT-Abo, Anmeldung als Datei, Websuche an. */
const CONFIG = [
  '-c', 'forced_login_method="chatgpt"',
  '-c', 'cli_auth_credentials_store="file"',
  '-c', 'web_search="live"',
];

type Result = { code: number | null; stdout: string; stderr: string };

/** Startet die Codex-CLI ohne geerbte API-Schlüssel oder persönliche Konfiguration. */
function runCodex(args: string[], input = '', timeoutMs = 15 * 60_000): Promise<Result> {
  const env: NodeJS.ProcessEnv = { CODEX_HOME: process.env.CODEX_HOME, NO_COLOR: '1' };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [codexCli, ...args], { cwd: aiWorkDir, env, timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolveResult({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

export const codex: AiProvider = {
  id: 'codex',
  label: 'ChatGPT',

  async status() {
    const result = await runCodex(['login', 'status'], '', 30_000);
    const detail = (result.stdout + result.stderr).trim();
    return result.code === 0 ? { loggedIn: true, detail } : { loggedIn: false };
  },

  /** Die Codex-CLI kann keine Modelle auflisten – es gibt nur „Standard“. */
  async models() {
    return [];
  },

  async run(prompt, schema, model) {
    if (!(await this.status()).loggedIn) {
      throw new Error('Bitte zuerst bei ChatGPT anmelden (siehe Einstellungen).');
    }
    const id = randomUUID();
    const schemaFile = resolve(aiWorkDir, `${id}-schema.json`);
    const outputFile = resolve(aiWorkDir, `${id}-output.json`);
    await writeFile(schemaFile, JSON.stringify(schema));

    try {
      const result = await runCodex([
        'exec',
        ...CONFIG,
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox', 'read-only',
        '--output-schema', schemaFile,
        '-o', outputFile,
        ...(model ? ['-m', model] : []),
        '-',
      ], prompt);

      if (result.code !== 0) {
        const lastLines = result.stderr.trim().split('\n').slice(-3).join(' ');
        throw new Error(`ChatGPT-Fehler: ${lastLines || 'unbekannt'}`);
      }
      try {
        return JSON.parse(await readFile(outputFile, 'utf8'));
      } catch {
        throw new Error('ChatGPT hat kein Ergebnis im erwarteten Format geliefert.');
      }
    } finally {
      await rm(schemaFile, { force: true });
      await rm(outputFile, { force: true });
    }
  },
};
