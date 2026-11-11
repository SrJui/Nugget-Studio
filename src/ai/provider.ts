import { getSetting } from '../db.ts';
import { claude } from './claude.ts';
import { codex } from './codex.ts';

export type ProviderId = 'claude' | 'codex';

export type ProviderStatus = { loggedIn: boolean; detail?: string };

export type ModelOption = { id: string; label: string };

/** Wie lange die KI nachdenkt: weniger ist schneller, mehr ist gründlicher. */
export type Effort = 'low' | 'medium' | 'high';

export const EFFORTS: Effort[] = ['low', 'medium', 'high'];

export function isEffort(value: unknown): value is Effort {
  return EFFORTS.includes(value as Effort);
}

export type RunOptions = {
  model?: string;
  effort?: Effort;
  /** Webrecherche erlauben (Standard: ja). Ohne geht es schneller. */
  research?: boolean;
};

export type AiProvider = {
  id: ProviderId;
  label: string;
  status(): Promise<ProviderStatus>;
  models(): Promise<ModelOption[]>;
  /** Führt einen Auftrag aus und gibt JSON passend zum Schema zurück. */
  run(prompt: string, schema: object, options: RunOptions): Promise<unknown>;
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

export const effortSettingKey = (role: Role) => `effort_${role}`;

const DEFAULT_EFFORT: Record<Role, Effort> = { writer: 'medium', checker: 'high' };

/** Der eingestellte Denkaufwand einer Rolle. */
export function effortFor(role: Role): Effort {
  const effort = getSetting(effortSettingKey(role));
  return isEffort(effort) ? effort : DEFAULT_EFFORT[role];
}

const ROLE_LABEL: Record<Role, string> = { writer: 'Schreiber', checker: 'Prüfer' };

/**
 * Führt einen Auftrag beim Anbieter der Rolle mit dem dort gewählten Modell und Denkaufwand aus.
 * `overrides` gilt nur für diesen Auftrag (z. B. Kürzen ohne Recherche). Die Dauer steht im Log.
 */
export async function runAs(role: Role, prompt: string, schema: object, overrides: RunOptions = {}): Promise<unknown> {
  const provider = providerFor(role);
  const options: RunOptions = {
    model: getSetting(modelSettingKey(provider.id)) || undefined,
    effort: effortFor(role),
    ...overrides,
  };
  const started = Date.now();
  try {
    return await provider.run(prompt, schema, options);
  } finally {
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`[${ROLE_LABEL[role]}] ${provider.label} · ${options.effort} · ${seconds} s`);
  }
}
