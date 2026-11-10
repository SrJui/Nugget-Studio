import { getSetting } from '../db.ts';
import { claude } from './claude.ts';
import { codex } from './codex.ts';

export type ProviderId = 'claude' | 'codex';

export type ProviderStatus = { loggedIn: boolean; detail?: string };

export type AiProvider = {
  id: ProviderId;
  label: string;
  status(): Promise<ProviderStatus>;
  /** Führt einen Auftrag mit Webrecherche aus und gibt JSON passend zum Schema zurück. */
  run(prompt: string, schema: object): Promise<unknown>;
};

export const providers: Record<ProviderId, AiProvider> = { claude, codex };

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in providers;
}

/** Der in den Einstellungen gewählte Anbieter (Standard: Claude). */
export function activeProvider(): AiProvider {
  const id = getSetting('provider');
  return isProviderId(id) ? providers[id] : providers.claude;
}
