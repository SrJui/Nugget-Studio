import { getSetting } from '../db.ts';
import { claude } from './claude.ts';
import { codex } from './codex.ts';

export type ProviderId = 'claude' | 'codex';

export type ProviderStatus = { loggedIn: boolean; detail?: string };

export type ModelOption = { id: string; label: string };

export type AiProvider = {
  id: ProviderId;
  label: string;
  status(): Promise<ProviderStatus>;
  models(): Promise<ModelOption[]>;
  /** Führt einen Auftrag mit Webrecherche aus und gibt JSON passend zum Schema zurück. */
  run(prompt: string, schema: object, model?: string): Promise<unknown>;
};

export const providers: Record<ProviderId, AiProvider> = { claude, codex };

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in providers;
}

export const modelSettingKey = (id: ProviderId) => `model_${id}`;

/** Die KI, die Facts schreibt, und die KI, die sie danach prüft. */
export type Role = 'writer' | 'checker';

export const ROLES: Role[] = ['writer', 'checker'];

export function isRole(value: unknown): value is Role {
  return value === 'writer' || value === 'checker';
}

export const roleSettingKey = (role: Role) => `provider_${role}`;

const DEFAULT_PROVIDER: Record<Role, ProviderId> = { writer: 'claude', checker: 'codex' };

/** Der Anbieter für eine Rolle. Der frühere einzelne Anbieter (`provider`) gilt als Schreiber. */
export function providerFor(role: Role): AiProvider {
  const id = getSetting(roleSettingKey(role)) ?? (role === 'writer' ? getSetting('provider') : undefined);
  return providers[isProviderId(id) ? id : DEFAULT_PROVIDER[role]];
}

/** Führt einen Auftrag beim Anbieter der Rolle mit dem dort gewählten Modell aus. */
export function runAs(role: Role, prompt: string, schema: object): Promise<unknown> {
  const provider = providerFor(role);
  return provider.run(prompt, schema, getSetting(modelSettingKey(provider.id)) || undefined);
}
