import type { DiffFile } from '@gigadrive/lupe-core';
import { renderDiffPrompt, serialiseFileDiff } from '@gigadrive/lupe-core';

// Re-export the core serialisers so consumers can keep importing them from here.
export { renderDiffPrompt, serialiseFileDiff };

/**
 * Qodo-style PR compression: drop files that waste tokens and create false
 * positives (binary/generated/lockfiles/vendored), rank what's left by
 * relevance, and budget the serialised diff against soft/hard token thresholds.
 */

/** Rough token estimate (~4 chars/token); good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const GENERATED_PATTERNS: readonly RegExp[] = [
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)out\//,
  /(^|\/)coverage\//,
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
  /(^|\/)__generated__\//,
  /\.min\.(js|css)$/,
  /\.(map)$/,
  /(^|\/)gen\//,
  /\.generated\./,
  /(^|\/)__snapshots__\//,
];

const LOCKFILES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'composer.lock',
  'Cargo.lock',
  'poetry.lock',
  'Gemfile.lock',
  'go.sum',
]);

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

export function isLockfile(path: string): boolean {
  return LOCKFILES.has(basename(path));
}

export function isGenerated(path: string): boolean {
  return GENERATED_PATTERNS.some((re) => re.test(path));
}

/**
 * Glob-ish path filter list (CodeRabbit/.lupe.yaml style): patterns starting
 * with `!` exclude. A bare pattern includes. Last match wins; default include.
 */
export function matchesFilters(path: string, filters: readonly string[]): boolean {
  let included = true;
  for (const raw of filters) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    if (globToRegExp(pattern).test(path)) included = !negated;
  }
  return included;
}

function globToRegExp(glob: string): RegExp {
  // Minimal glob: ** => any, * => segment, ? => one char. Anchored loosely.
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += `\\${c}`;
    else if (c === '/') re += '/';
    else re += c;
  }
  return new RegExp(`(^|/)${re}$|^${re}$`);
}

export type DropReason = 'binary' | 'generated' | 'lockfile' | 'filtered' | 'no-hunks' | 'budget';

export interface DroppedFile {
  readonly path: string;
  readonly reason: DropReason;
}

export interface CompressOptions {
  readonly pathFilters?: readonly string[];
  /** Hard cap on serialised diff tokens. Files beyond it are dropped. */
  readonly maxTokens?: number;
  /** Per-file hunk cap; oversized files are truncated, not dropped. */
  readonly maxFilesReviewed?: number;
  /**
   * Chunk mode: do file selection only and skip the token-budget drop. Over-budget
   * files are then handled by the engine's chunked map-reduce review instead of
   * being silently truncated here. `maxFilesReviewed` and content drops still apply.
   */
  readonly chunk?: boolean;
}

export interface CompressedContext {
  readonly files: readonly DiffFile[];
  readonly dropped: readonly DroppedFile[];
  readonly tokens: number;
  readonly truncated: boolean;
}

/** Score a file for review priority. Higher = more important. */
function relevanceScore(file: DiffFile): number {
  const churn = file.additions + file.deletions;
  const path = file.path;
  let score = churn;
  // Source code is more interesting than tests/docs/config.
  if (/\.(ts|tsx|js|jsx|mjs|cjs|go|rs|py|java|rb|php|c|cc|cpp|h|hpp|cs|kt|swift)$/.test(path)) score += 50;
  if (/(^|\/)(test|tests|__tests__|spec)\//.test(path) || /\.(test|spec)\./.test(path)) score -= 20;
  if (/\.(md|mdx|txt|rst)$/.test(path)) score -= 30;
  if (/\.(json|ya?ml|toml|ini|cfg)$/.test(path)) score -= 10;
  if (file.status === 'added') score += 10;
  return score;
}

/** Apply the full compression pipeline and return the review-ready file set. */
export function compressDiff(files: readonly DiffFile[], options: CompressOptions = {}): CompressedContext {
  const maxTokens = options.maxTokens ?? 120_000;
  const dropped: DroppedFile[] = [];
  const keep: DiffFile[] = [];

  for (const file of files) {
    if (file.binary) {
      dropped.push({ path: file.path, reason: 'binary' });
    } else if (isLockfile(file.path)) {
      dropped.push({ path: file.path, reason: 'lockfile' });
    } else if (isGenerated(file.path)) {
      dropped.push({ path: file.path, reason: 'generated' });
    } else if (options.pathFilters && !matchesFilters(file.path, options.pathFilters)) {
      dropped.push({ path: file.path, reason: 'filtered' });
    } else if (file.hunks.length === 0) {
      dropped.push({ path: file.path, reason: 'no-hunks' });
    } else {
      keep.push(file);
    }
  }

  const ranked = [...keep].sort((a, b) => relevanceScore(b) - relevanceScore(a));
  const limited =
    options.maxFilesReviewed && ranked.length > options.maxFilesReviewed
      ? ranked.slice(0, options.maxFilesReviewed)
      : ranked;
  for (const f of ranked.slice(limited.length)) dropped.push({ path: f.path, reason: 'budget' });

  // Chunk mode: file selection only. Token budgeting is handled downstream by the
  // engine's chunked review, so we never silently drop over-budget files here.
  if (options.chunk) {
    const tokens = limited.reduce((acc, f) => acc + estimateTokens(serialiseFileDiff(f)), 0);
    return { files: limited, dropped, tokens, truncated: false };
  }

  const included: DiffFile[] = [];
  let tokens = 0;
  let truncated = false;
  for (const file of limited) {
    const cost = estimateTokens(serialiseFileDiff(file));
    if (tokens + cost > maxTokens && included.length > 0) {
      dropped.push({ path: file.path, reason: 'budget' });
      truncated = true;
      continue;
    }
    included.push(file);
    tokens += cost;
  }

  return { files: included, dropped, tokens, truncated };
}
