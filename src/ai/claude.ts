import { deleteSetting, getSetting, setSetting } from '../db.ts';
import type { AiProvider } from './provider.ts';
import { runCommand } from './run-command.ts';

const TOKEN_KEY = 'claude_token';
const WEB_TOOLS = 'WebSearch,WebFetch';

/** Speichert den Schlüssel aus `claude setup-token`. */
export function saveClaudeToken(token: string) {
  setSetting(TOKEN_KEY, token.trim());
}

export function removeClaudeToken() {
  deleteSetting(TOKEN_KEY);
}

function tokenEnv(): Record<string, string> {
  const token = getSetting(TOKEN_KEY);
  return token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {};
}

export const claude: AiProvider = {
  id: 'claude',
  label: 'Claude',

  async status() {
    if (!getSetting(TOKEN_KEY)) return { loggedIn: false, detail: 'Kein Schlüssel hinterlegt' };
    const result = await runCommand('claude', ['auth', 'status', '--json'], { env: tokenEnv(), timeoutMs: 30_000 });
    try {
      const status = JSON.parse(result.stdout);
      return { loggedIn: Boolean(status.loggedIn), detail: status.email ?? status.authMethod };
    } catch {
      return { loggedIn: false, detail: result.stderr.trim() || 'Status unbekannt' };
    }
  },

  async run(prompt, schema) {
    const result = await runCommand(
      'claude',
      [
        '-p',
        '--output-format', 'json',
        '--json-schema', JSON.stringify(schema),
        '--tools', WEB_TOOLS,
        '--allowedTools', WEB_TOOLS,
      ],
      { input: prompt, env: tokenEnv() },
    );

    let response;
    try {
      response = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Claude: ${result.stderr.trim() || result.stdout.trim() || 'keine Antwort'}`);
    }
    if (response.is_error) throw new Error(`Claude: ${response.result}`);
    return response.structured_output ?? JSON.parse(response.result);
  },
};
