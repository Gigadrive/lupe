import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';

import { loadConfig } from 'c12';
import { Effect } from 'effect';
import { parse as parseYaml } from 'yaml';

import { ConfigError, normalizeConfig, type ApiProviderId, type LupeConfig } from '@gigadrive/lupe-core';

/** CLI providers = AI-SDK providers plus the opt-in local-credential backends. */
export type CliProvider = ApiProviderId | 'claude-cli' | 'codex-cli';

/** Normalised lupe config for the CLI — core's shared `LupeConfig` with the provider narrowed. */
export type LupeFileConfig = Omit<LupeConfig, 'provider'> & { readonly provider?: CliProvider };

type RawConfig = Record<string, unknown>;

async function loadRaw(cwd: string): Promise<RawConfig> {
  for (const name of ['.lupe.yaml', '.lupe.yml']) {
    const file = nodePath.join(cwd, name);
    if (existsSync(file)) {
      const parsed = parseYaml(await fs.readFile(file, 'utf8'));
      return (parsed as RawConfig | null) ?? {};
    }
  }
  const { config } = await loadConfig<RawConfig>({ name: 'lupe', cwd, rcFile: false, globalRc: false });
  return config ?? {};
}

/** Load + normalise the layered config for a working directory. */
export function loadFileConfig(cwd: string): Effect.Effect<LupeFileConfig, ConfigError> {
  return Effect.tryPromise({
    try: async () => {
      const base = normalizeConfig(await loadRaw(cwd));
      return { ...base, provider: base.provider as CliProvider | undefined };
    },
    catch: (cause) => new ConfigError({ message: 'failed to load lupe config', cause }),
  });
}

/** Env var conventionally holding the API key for a provider (none for local CLIs). */
export function providerKeyEnv(provider: CliProvider): string | undefined {
  switch (provider) {
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
    case 'openai-compatible':
      return 'OPENAI_API_KEY';
    case 'google':
      return 'GOOGLE_GENERATIVE_AI_API_KEY';
    case 'gateway':
      return 'AI_GATEWAY_API_KEY';
    case 'bedrock':
      return 'AWS_ACCESS_KEY_ID';
    case 'claude-cli':
    case 'codex-cli':
      return undefined;
  }
}
