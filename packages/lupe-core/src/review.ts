import type { DiffFile } from './diff';

/** Owner/repo coordinates. */
export interface RepoRef {
  readonly owner: string;
  readonly repo: string;
}

export interface PullRequestRef extends RepoRef {
  readonly number: number;
}

/** What is being reviewed: a GitHub PR (Action / `review <pr>`) or a local diff (CLI). */
export interface ReviewTarget {
  readonly kind: 'pull_request' | 'local';
  readonly repo?: RepoRef;
  readonly pullNumber?: number;
  readonly baseRef?: string;
  readonly headRef?: string;
  readonly baseSha?: string;
  readonly headSha?: string;
  /** Last SHA lupe already reviewed — drives incremental head-vs-last-reviewed diffs. */
  readonly lastReviewedSha?: string;
  readonly title?: string;
  readonly body?: string;
  readonly isDraft?: boolean;
}

/** Normalised engine input produced by an ingest adapter (CLI or Action). */
export interface ReviewRequest {
  readonly target: ReviewTarget;
  readonly files: readonly DiffFile[];
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

export interface ModelCost {
  readonly model: string;
  readonly usage: TokenUsage;
  readonly costUsd: number;
}

export interface CostSummary {
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly byModel: readonly ModelCost[];
}

export const EMPTY_COST: CostSummary = {
  usage: EMPTY_USAGE,
  costUsd: 0,
  byModel: [],
};
