import type { DiffFile } from '../diff';
import { serialiseFileDiff } from '../render/diff-prompt';

/**
 * Chunk planning for large-PR map-reduce review. When a diff is too big for one
 * model call, we split it into token-bounded chunks reviewed independently and
 * merge the candidate findings downstream — instead of silently truncating.
 *
 * Planning lives in core (it only needs `serialiseFileDiff` + a token estimate)
 * because `lupe-core` cannot depend on `lupe-git`; orchestration lives in the
 * pipeline (it touches the `AiModel` seam).
 */

/** Rough token estimate (~4 chars/token); mirrors lupe-git's compression estimator. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Default serialised-diff token budget per review chunk. */
const DEFAULT_MAX_CHUNK_TOKENS = 120_000;
/** Default hard ceiling on the number of chunks (a CI cost bound). */
const DEFAULT_MAX_CHUNKS = 8;

export interface ChunkPlanOptions {
  /** Max serialised-diff tokens per review chunk. Default 120_000. */
  readonly maxChunkTokens?: number;
  /** Hard ceiling on the number of chunks. Default 8. Files beyond it are reported, not dropped silently. */
  readonly maxChunks?: number;
}

export interface ChunkPlan {
  /** Token-bounded groups of files; each is reviewed in one model call. */
  readonly chunks: readonly (readonly DiffFile[])[];
  /** Files left unreviewed because the `maxChunks` ceiling was reached (surfaced, never silent). */
  readonly skipped: readonly string[];
  /** Files whose own serialised diff exceeds `maxChunkTokens` (reviewed alone, flagged). */
  readonly oversizedFiles: readonly string[];
}

/**
 * Greedy bin-pack the (already relevance-ranked) files into token-bounded chunks.
 * Order is preserved, so the highest-ranked files land in the earliest chunks. A
 * single file larger than the budget becomes its own chunk (never dropped). Files
 * that don't fit within `maxChunks` are reported in `skipped` — the only place
 * anything is excluded for size, and it is always surfaced to the caller.
 */
export function planChunks(files: readonly DiffFile[], options: ChunkPlanOptions = {}): ChunkPlan {
  const maxChunkTokens = options.maxChunkTokens ?? DEFAULT_MAX_CHUNK_TOKENS;
  const maxChunks = Math.max(1, options.maxChunks ?? DEFAULT_MAX_CHUNKS);

  const chunks: DiffFile[][] = [];
  const skipped: string[] = [];
  const oversizedFiles: string[] = [];

  let current: DiffFile[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
  };

  for (const file of files) {
    const cost = estimateTokens(serialiseFileDiff(file));
    const oversized = cost > maxChunkTokens;
    if (oversized) oversizedFiles.push(file.path);

    const fitsCurrent = current.length > 0 && !oversized && currentTokens + cost <= maxChunkTokens;
    if (fitsCurrent) {
      current.push(file);
      currentTokens += cost;
      continue;
    }

    // This file needs a fresh chunk (oversized, current full, or current empty).
    flush();
    if (chunks.length >= maxChunks) {
      skipped.push(file.path);
      continue;
    }
    current.push(file);
    currentTokens += cost;
    if (oversized) flush(); // an oversized file stands alone
  }
  flush();

  return { chunks, skipped, oversizedFiles };
}
