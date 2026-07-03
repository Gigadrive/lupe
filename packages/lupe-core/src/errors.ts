import { Data } from 'effect';

/**
 * Tagged errors live in the Effect error (E) channel — never thrown opaquely.
 * Each adapter (AI SDK, Octokit, subprocess) lifts its raw failures into one of
 * these at exactly one seam.
 */

/** A provider/model call failed (network, 4xx/5xx, malformed response). */
export class ProviderError extends Data.TaggedError('ProviderError')<{
  readonly message: string;
  readonly provider?: string;
  readonly model?: string;
  readonly cause?: unknown;
}> {}

/** The model refused to answer (e.g. Anthropic stop_reason "refusal"). Triggers fallback, not a hard stop. */
export class RefusalError extends Data.TaggedError('RefusalError')<{
  readonly message: string;
  readonly model?: string;
}> {}

/** Rate limited; `retryAfterMs` drives the Schedule backoff when known. */
export class RateLimitError extends Data.TaggedError('RateLimitError')<{
  readonly message: string;
  readonly provider?: string;
  readonly retryAfterMs?: number;
}> {}

/** Unified-diff parsing failed. */
export class DiffParseError extends Data.TaggedError('DiffParseError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** A finding could not be anchored to a valid (line, side) in the diff (would 422 on GitHub). */
export class AnchorError extends Data.TaggedError('AnchorError')<{
  readonly message: string;
  readonly path: string;
  readonly line?: number;
  readonly side?: 'LEFT' | 'RIGHT';
}> {}

/** Structured output could not be produced/validated (e.g. AI SDK NoObjectGeneratedError). */
export class ReviewOutputError extends Data.TaggedError('ReviewOutputError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Invalid or missing configuration. */
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * A review run's estimated or actual cost exceeded the configured `maxCostUsd`
 * cap — or the cap could not be enforced because the model has no known price
 * (fail-closed). Thrown before/mid the model calls so spend is bounded.
 */
export class CostLimitError extends Data.TaggedError('CostLimitError')<{
  readonly message: string;
  readonly limitUsd: number;
  readonly estimatedUsd?: number;
  readonly spentUsd?: number;
}> {}

/** GitHub transport failure. */
export class GitHubError extends Data.TaggedError('GitHubError')<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

/** A local-credential subprocess (claude/codex) failed or produced unparsable output. */
export class SubprocessError extends Data.TaggedError('SubprocessError')<{
  readonly message: string;
  readonly command?: string;
  readonly code?: number;
  readonly cause?: unknown;
}> {}

/** Union of every lupe error — handy for exhaustive handling at the app boundary. */
export type LupeError =
  | ProviderError
  | RefusalError
  | RateLimitError
  | DiffParseError
  | AnchorError
  | ReviewOutputError
  | ConfigError
  | CostLimitError
  | GitHubError
  | SubprocessError;
