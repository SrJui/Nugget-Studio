import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { aiWorkDir } from '../config.ts';
import type { AiProvider, ModelOption } from './provider.ts';

/**
 * ChatGPT-Abo über die Codex-CLI. Nutzt den Login aus `codex login --device-auth`
 * (im Container: `docker compose exec -it studio codex login --device-auth`).
 */

const codexCli = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');

/** Einstellungen für jeden Aufruf: nur ChatGPT-Abo, Anmeldung als Datei. */
const CONFIG = [
  '-c', 'forced_login_method="chatgpt"',
  '-c', 'cli_auth_credentials_store="file"',
];

const LOGIN_HINT = 'Bitte zuerst bei ChatGPT anmelden (siehe Einstellungen).';

type Result = { code: number | null; stdout: string; stderr: string };

/** Umgebung ohne geerbte API-Schlüssel oder persönliche Konfiguration. */
function codexEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CODEX_HOME: process.env.CODEX_HOME, NO_COLOR: '1' };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

function runCodex(args: string[], input = '', timeoutMs = 15 * 60_000): Promise<Result> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [codexCli, ...args], { cwd: aiWorkDir, env: codexEnv(), timeout: timeoutMs });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolveResult({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

type RpcReply = { id?: number; result?: unknown; error?: { message: string } };
type ModelPage = { data: { model: string; displayName?: string }[]; nextCursor: string | null };

/**
 * `codex exec` kann keine Modelle auflisten. Dafür startet hier kurz der Codex-App-Server
 * (JSON-Nachrichten, eine pro Zeile), fragt `model/list` ab und wird wieder beendet.
 */
async function listModels(timeoutMs = 30_000): Promise<ModelOption[]> {
  const child = spawn(process.execPath, [codexCli, 'app-server', '--listen', 'stdio://', ...CONFIG], {
    cwd: aiWorkDir,
    env: codexEnv(),
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  child.stdin.on('error', () => {});

  const waiting = new Map<number, (reply: RpcReply) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const reply: RpcReply = JSON.parse(line);
      if (typeof reply.id === 'number') waiting.get(reply.id)?.(reply);
    } catch {
      // Keine JSON-Zeile – ignorieren.
    }
  });

  let nextId = 1;
  const request = <T>(method: string, params: object) =>
    new Promise<T>((resolveReply, reject) => {
      const id = nextId++;
      waiting.set(id, (reply) => (reply.error ? reject(new Error(reply.error.message)) : resolveReply(reply.result as T)));
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });

  async function fetchAll() {
    await request('initialize', { clientInfo: { name: 'nugget-studio', title: 'Nugget Studio', version: '0.1.0' } });
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
    const models: ModelOption[] = [];
    let cursor: string | null = null;
    do {
      const page: ModelPage = await request('model/list', { limit: 100, cursor, includeHidden: false });
      models.push(...page.data.map((model) => ({ id: model.model, label: model.displayName || model.model })));
      cursor = page.nextCursor;
    } while (cursor);
    return models;
  }

  let timer: NodeJS.Timeout | undefined;
  const failed = new Promise<never>((_, reject) => {
    child.on('error', () => reject(new Error('Codex konnte nicht gestartet werden.')));
    child.on('exit', () => reject(new Error('Codex wurde beim Abfragen der Modelle beendet.')));
    timer = setTimeout(() => reject(new Error('Zeitüberschreitung beim Abfragen der ChatGPT-Modelle.')), timeoutMs);
  });

  try {
    return await Promise.race([fetchAll(), failed]);
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}

export const codex: AiProvider = {
  id: 'codex',
  label: 'ChatGPT',

  async status() {
    const result = await runCodex(['login', 'status'], '', 30_000);
    const detail = (result.stdout + result.stderr).trim();
    return result.code === 0 ? { loggedIn: true, detail } : { loggedIn: false };
  },

  models() {
    return listModels();
  },

  async run(prompt, schema, { model, effort, research = true }) {
    const id = randomUUID();
    const schemaFile = resolve(aiWorkDir, `${id}-schema.json`);
    const outputFile = resolve(aiWorkDir, `${id}-output.json`);
    await writeFile(schemaFile, JSON.stringify(schema));

    try {
      const result = await runCodex([
        'exec',
        ...CONFIG,
        '-c', `web_search="${research ? 'live' : 'disabled'}"`,
        ...(effort ? ['-c', `model_reasoning_effort="${effort}"`] : []),
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
        // Statt vor jedem Auftrag den Login zu prüfen (eigener Prozess), erst im Fehlerfall danach schauen.
        if (/not logged in|login|unauthorized|401/i.test(lastLines)) throw new Error(LOGIN_HINT);
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
