import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { aiWorkDir } from '../config.ts';

export type RpcMessage = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message: string };
};

const codexCli = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');

/**
 * Ein eigener Codex-App-Server-Prozess ohne geerbte API-Schlüssel oder persönliche Konfiguration.
 * Kommunikation über JSON-Nachrichten, eine pro Zeile.
 */
export class CodexClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private listeners = new Set<(message: RpcMessage) => void>();
  private failure?: Error;

  constructor() {
    const env: NodeJS.ProcessEnv = { CODEX_HOME: process.env.CODEX_HOME };
    for (const key of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    this.child = spawn(process.execPath, [
      codexCli, 'app-server', '--listen', 'stdio://',
      '-c', 'model_provider="openai"',
      '-c', 'forced_login_method="chatgpt"',
      '-c', 'cli_auth_credentials_store="file"',
      '-c', 'features.shell_tool=false',
      '-c', 'features.code_mode=false',
      '-c', 'features.view_image=false',
      '-c', 'include_apply_patch_tool=false',
      '-c', 'web_search="live"',
    ], { env, cwd: aiWorkDir, stdio: 'pipe' });

    // stderr kann Startdiagnosen enthalten; nichts davon an die Oberfläche weitergeben.
    this.child.stderr.resume();
    this.child.on('error', () => this.fail(new Error('Codex konnte nicht gestartet werden.')));
    this.child.on('exit', () => this.fail(new Error('Die Verbindung zu Codex wurde beendet.')));
    this.child.stdin.on('error', () => this.fail(new Error('Die Verbindung zu Codex wurde unterbrochen.')));

    createInterface({ input: this.child.stdout }).on('line', (line) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (!message.method && typeof message.id === 'number') {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        for (const listener of this.listeners) listener(message);
      }
    });
  }

  async initialize() {
    await this.request('initialize', {
      clientInfo: { name: 'nugget-studio', title: 'Nugget Studio', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized' });
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Zeitüberschreitung bei Codex (${method}).`));
      }, 30_000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.send({ id, method, params });
    });
  }

  send(message: RpcMessage) {
    if (!this.failure && !this.child.stdin.destroyed) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  subscribe(listener: (message: RpcMessage) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'nugget/disconnected', params: { message: error.message } });
  }

  close() {
    this.fail(new Error('Codex-Verbindung geschlossen.'));
    this.listeners.clear();
    this.child.stdin.end();
    this.child.kill();
  }
}
