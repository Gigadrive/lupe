import type { Category, Severity } from './finding';
import { Severity as SeveritySchema } from './finding';
import type { CategoryThreshold, PathThreshold } from './review/filter';

/** Path-scoped review instructions injected into the prompt prefix. */
export interface PathInstructionConfig {
  readonly path: string;
  readonly instructions: string;
}

/**
 * Normalised lupe config, shared by the CLI and the Action. This is the single
 * source of truth for the `.lupe.yaml` schema. `normalizeConfig` is PURE (no
 * IO) — each app reads the file (yaml / c12) and shapes the raw object here, so
 * core stays IO-light.
 */
export interface LupeConfig {
  readonly profile?: 'chill' | 'assertive';
  /** Provider id; kept loose (the CLI narrows it to include local backends). */
  readonly provider?: string;
  readonly models?: Record<string, string>;
  readonly baseURL?: string;
  readonly pathFilters?: readonly string[];
  readonly pathInstructions?: readonly PathInstructionConfig[];
  /** Explicit coding standards; overrides auto-discovered rule files. */
  readonly codingStandards?: string;
  readonly maxFiles?: number;
  readonly maxFindings?: number;
  readonly confidenceThreshold?: number;
  readonly suppressAdvisory?: boolean;
  readonly categoryThresholds?: Partial<Record<Category, CategoryThreshold>>;
  readonly pathThresholds?: readonly PathThreshold[];
  /** Inline-comment gate (transport): findings less severe than this stay summary-only. */
  readonly minSeverityToComment?: Severity;
  readonly maxChunkTokens?: number;
  readonly maxChunks?: number;
  readonly reviewConcurrency?: number;
}

type RawConfig = Record<string, unknown>;

const CATEGORIES: readonly Category[] = [
  'correctness',
  'security',
  'performance',
  'concurrency',
  'error-handling',
  'resource-leak',
  'api-misuse',
  'data-loss',
  'maintainability',
  'style',
  'test',
  'docs',
];

function isRecord(value: unknown): value is RawConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? (value as T[]) : undefined;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function pickBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function pickSeverity(value: unknown): Severity | undefined {
  const parsed = SeveritySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Read camel/snake `minConfidence`/`minSeverity` from a raw threshold object. */
function pickGate(raw: unknown): CategoryThreshold | undefined {
  if (!isRecord(raw)) return undefined;
  const minConfidence = pickNumber(raw['minConfidence'] ?? raw['min_confidence']);
  const minSeverity = pickSeverity(raw['minSeverity'] ?? raw['min_severity']);
  if (minConfidence === undefined && minSeverity === undefined) return undefined;
  return { minConfidence, minSeverity };
}

function pickCategoryThresholds(raw: unknown): Partial<Record<Category, CategoryThreshold>> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Partial<Record<Category, CategoryThreshold>> = {};
  let any = false;
  for (const cat of CATEGORIES) {
    const gate = pickGate(raw[cat]);
    if (gate) {
      out[cat] = gate;
      any = true;
    }
  }
  return any ? out : undefined;
}

function pickPathThresholds(raw: unknown): PathThreshold[] | undefined {
  const arr = pickArray<unknown>(raw);
  if (!arr) return undefined;
  const out: PathThreshold[] = [];
  for (const entry of arr) {
    if (!isRecord(entry)) continue;
    const glob = pickString(entry['glob']);
    if (!glob) continue;
    const gate = pickGate(entry);
    out.push({ glob, ...gate });
  }
  return out.length > 0 ? out : undefined;
}

/** Shape a raw config object (yaml/c12) into a normalised `LupeConfig`. Pure. */
export function normalizeConfig(raw: RawConfig): LupeConfig {
  const get = (...keys: string[]): unknown => {
    for (const k of keys) if (raw[k] !== undefined) return raw[k];
    return undefined;
  };

  const profile = pickString(get('profile'));

  return {
    profile: profile === 'assertive' ? 'assertive' : profile === 'chill' ? 'chill' : undefined,
    provider: pickString(get('provider')),
    models: (get('models') as Record<string, string> | undefined) ?? undefined,
    baseURL: pickString(get('baseURL', 'base_url')),
    pathFilters: pickArray<string>(get('pathFilters', 'path_filters')),
    pathInstructions: pickArray<PathInstructionConfig>(get('pathInstructions', 'path_instructions')),
    codingStandards: pickString(get('codingStandards', 'coding_standards')),
    maxFiles: pickNumber(get('maxFiles', 'max_files')),
    maxFindings: pickNumber(get('maxFindings', 'max_findings')),
    confidenceThreshold: pickNumber(get('confidenceThreshold', 'confidence_threshold')),
    suppressAdvisory: pickBoolean(get('suppressAdvisory', 'suppress_advisory')),
    categoryThresholds: pickCategoryThresholds(get('categoryThresholds', 'category_thresholds')),
    pathThresholds: pickPathThresholds(get('pathThresholds', 'path_thresholds')),
    minSeverityToComment: pickSeverity(get('minSeverityToComment', 'min_severity_to_comment')),
    maxChunkTokens: pickNumber(get('maxChunkTokens', 'max_chunk_tokens')),
    maxChunks: pickNumber(get('maxChunks', 'max_chunks')),
    reviewConcurrency: pickNumber(get('reviewConcurrency', 'review_concurrency')),
  };
}
