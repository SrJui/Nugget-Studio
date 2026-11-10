import { spawn } from 'node:child_process';
import { aiWorkDir } from '../config.ts';

export type CommandResult = { code: number | null; stdout: string; stderr: string };

type Options = {
  input?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

/** Startet ein Programm im leeren KI-Arbeitsordner und wartet auf das Ende. */
export function runCommand(command: string, args: string[], options: Options = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: aiWorkDir,
      env: { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? 10 * 60_000,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));

    child.stdin.end(options.input ?? '');
  });
}
