import { Context } from 'effect';
import type { Effect } from 'effect';

import type { DiffFile, Anchor } from './diff';
import type { DiffParseError, GitHubError } from './errors';
import type { PullRequestRef, ReviewTarget } from './review';

/**
 * Read-only access to the repository under review. Implemented by
 * @gigadrive/lupe-git (local FS + git) and indirectly by the Action.
 * Backs both the ingest step and the agent's read-only tools.
 */
export interface RepoSourceService {
  /** Acquire the diff for a target (local git range or PR). */
  readonly acquireDiff: (target: ReviewTarget) => Effect.Effect<readonly DiffFile[], DiffParseError>;
  /** Read a file from the head checkout. */
  readonly readFile: (path: string) => Effect.Effect<string, DiffParseError>;
  /** List directory entries (non-recursive). */
  readonly listDir: (path: string) => Effect.Effect<readonly string[], DiffParseError>;
  /** Search the repo for a regex; returns `path:line:text` style matches. */
  readonly grep: (
    pattern: string,
    options?: { readonly glob?: string; readonly maxResults?: number }
  ) => Effect.Effect<readonly string[], DiffParseError>;
}

export class RepoSource extends Context.Tag('@gigadrive/lupe-core/RepoSource')<RepoSource, RepoSourceService>() {}

/** A symbol discovered in the repository (function, class, type, variable, etc.). */
export interface RepoSymbol {
  readonly path: string;
  readonly name: string;
  readonly kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'method' | 'property' | 'unknown';
  readonly line: number;
  readonly column?: number;
}

/** A lightweight, read-only code index used to ground reviews in repo context. */
export interface RepoIndexService {
  /** Find the definition(s) of a symbol by name (optionally scoped to a path). */
  readonly findDefinitions: (
    name: string,
    options?: { readonly path?: string; readonly maxResults?: number }
  ) => Effect.Effect<readonly RepoSymbol[], DiffParseError>;
  /** Find references to a symbol across the repo (optionally scoped to a path). */
  readonly findReferences: (
    name: string,
    options?: { readonly path?: string; readonly maxResults?: number }
  ) => Effect.Effect<readonly string[], DiffParseError>;
}

export class RepoIndex extends Context.Tag('@gigadrive/lupe-core/RepoIndex')<RepoIndex, RepoIndexService>() {}

/** One anchored inline comment ready to post. */
export interface AnchoredComment {
  readonly anchor: Anchor;
  /** Markdown body (may include a ```suggestion block). */
  readonly body: string;
}

export interface PostReviewInput {
  readonly pr: PullRequestRef;
  readonly headSha: string;
  readonly comments: readonly AnchoredComment[];
  /** Body of the single sticky `<!-- lupe-summary -->` comment. */
  readonly summaryBody: string;
  /** Resolve inline threads from prior runs that no longer apply. */
  readonly resolveStaleThreads: boolean;
}

/**
 * GitHub transport. Implemented by @gigadrive/lupe-github. The engine depends
 * only on this interface, so the CLI (print mode) can omit it entirely.
 */
export interface GitHubClientService {
  /** Per-file patch hunks via paginated `pulls.listFiles`. */
  readonly listDiff: (pr: PullRequestRef) => Effect.Effect<readonly DiffFile[], GitHubError>;
  /**
   * Per-file patch hunks for just `baseSha..headSha` (incremental re-review via
   * the compare API). Fails (so the caller can fall back to {@link listDiff})
   * when the comparison is not a clean fast-forward — e.g. a force-push/rebase.
   */
  readonly listDiffSince: (
    pr: PullRequestRef,
    baseSha: string,
    headSha: string
  ) => Effect.Effect<readonly DiffFile[], GitHubError>;
  /** Last SHA lupe reviewed, read from the sticky summary marker (incremental review). */
  readonly getLastReviewedSha: (pr: PullRequestRef) => Effect.Effect<string | undefined, GitHubError>;
  /** Post ALL findings as one review + upsert the sticky summary. */
  readonly postReview: (input: PostReviewInput) => Effect.Effect<void, GitHubError>;
}

export class GitHubClient extends Context.Tag('@gigadrive/lupe-core/GitHubClient')<
  GitHubClient,
  GitHubClientService
>() {}
