import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { aiWorkDir } from '../config.ts';
import type { AiProvider } from './provider.ts';
import { runCommand } from './run-command.ts';

export type CodexLogin = {
  state: 'idle' | 'waiting' | 'done' | 'error';
  url?: string;
  code?: string;
  message?: string;
};

let login: CodexLogin = { state: 'idle' };

export function codexLoginState(): CodexLogin {
  return login;
}

/**
 * Startet die Geräte-Anmeldung. Liefert Link und Code, sobald Codex sie ausgegeben hat.
 * Der Vorgang läuft danach weiter, bis die Anmeldung im Browser bestätigt ist.
 */
export function startCodexLogin(): Promise<CodexLogin> {
  if (login.state === 'waiting') return Promise.resolve(login);

  login = { state: 'waiting' };
  const child = spawn('codex', ['login', '--device-auth'], {
    cwd: aiWorkDir,
    env: { ...process.env, NO_COLOR: '1' },
  });

  return new Promise((resolveLogin) => {
    let output = '';
    const onOutput = (chunk: Buffer) => {
      output += chunk;
      const text = output.replace(/\x1b\[[0-9;]*m/g, '');
      login.url ??= text.match(/https:\/\/\S+/)?.[0];
      login.code ??= text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,5}\b/)?.[0];
      if (login.url && login.code) resolveLogin(login);
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.on('error', (error) => {
      login = { state: 'error', message: error.message };
      resolveLogin(login);
    });
    child.on('close', (code) => {
      login = code === 0
        ? { state: 'done' }
        : { state: 'error', message: 'Anmeldung abgebrochen oder abgelaufen.' };
      resolveLogin(login);
    });
  });
}

export async function codexLogout() {
  await runCommand('codex', ['logout'], { timeoutMs: 30_000 });
  login = { state: 'idle' };
}

export const codex: AiProvider = {
  id: 'codex',
  label: 'ChatGPT (Codex)',

  async status() {
    const result = await runCommand('codex', ['login', 'status'], { timeoutMs: 30_000 });
    const detail = (result.stdout + result.stderr).trim();
    return { loggedIn: result.code === 0, detail };
  },

  async run(prompt, schema) {
    const id = randomUUID();
    const schemaFile = resolve(aiWorkDir, `${id}-schema.json`);
    const outputFile = resolve(aiWorkDir, `${id}-output.json`);
    await writeFile(schemaFile, JSON.stringify(schema));

    try {
      const result = await runCommand(
        'codex',
        [
          '--search',
          'exec',
          '--skip-git-repo-check',
          '--ephemeral',
          '--sandbox', 'read-only',
          '--output-schema', schemaFile,
          '-o', outputFile,
          '-',
        ],
        { input: prompt },
      );
      if (result.code !== 0) {
        throw new Error(`Codex: ${result.stderr.trim().split('\n').slice(-3).join(' ') || 'Fehler'}`);
      }
      return JSON.parse(await readFile(outputFile, 'utf8'));
    } finally {
      await rm(schemaFile, { force: true });
      await rm(outputFile, { force: true });
    }
  },
};
