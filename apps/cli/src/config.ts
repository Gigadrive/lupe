import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';

import { loadConfig } from 'c12';
import { Effect } from 'effect';
import { parse as parseYaml } from 'yaml';

import { ConfigError, type ApiProviderId } from '@gigadrive/lupe-core';

/** CLI providers = AI-SDK providers plus the opt-in local-credential backends. */
export type CliProvider = ApiProviderId | 'claude-cli' | 'codex-cli';

interface PathInstructionConfig {
  readonly path: string;
  readonly instructions: string;
}

/** Normalised lupe config (from `.lupe.yaml` or `lupe.config.*`). */
export interface LupeFileConfig {
  readonly profile?: 'chill' | 'assertive';
  readonly provider?: CliProvider;
  readonly models?: Record<string, string>;
  readonly baseURL?: string;
  readonly pathFilters?: readonly string[];
  readonly pathInstructions?: readonly PathInstructionConfig[];
  readonly maxFiles?: number;
  readonly maxFindings?: number;
  readonly confidenceThreshold?: number;
}

type RawConfig = Record<string, unknown>;

function pickArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Accept both snake_case (yaml) and camelCase keys. */
function normalize(raw: RawConfig): LupeFileConfig {
  const get = (...keys: string[]): unknown => {
    for (const k of keys) if (raw[k] !== undefined) return raw[k];
    return undefined;
  };

  const profile = pickString(get('profile'));
  const provider = pickString(get('provider'));
  const models = (get('models') as Record<string, string> | undefined) ?? undefined;

  return {
    profile: profile === 'assertive' ? 'assertive' : profile === 'chill' ? 'chill' : undefined,
    provider: provider as CliProvider | undefined,
    models,
    baseURL: pickString(get('baseURL', 'base_url')),
    pathFilters: pickArray<string>(get('pathFilters', 'path_filters')),
    pathInstructions: pickArray<PathInstructionConfig>(get('pathInstructions', 'path_instructions')),
    maxFiles: pickNumber(get('maxFiles', 'max_files')),
    maxFindings: pickNumber(get('maxFindings', 'max_findings')),
    confidenceThreshold: pickNumber(get('confidenceThreshold', 'confidence_threshold')),
  };
}

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
    try: async () => normalize(await loadRaw(cwd)),
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
