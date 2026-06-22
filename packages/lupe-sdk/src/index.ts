import { Effect, Layer } from 'effect';

import {
  AiSdkLive,
  GitHubClient,
  RepoSource,
  renderSarif,
  runReview,
  type CostSummary,
  type Finding,
  type LupeAiConfig,
  type PullRequestRef,
  type ReviewProfile,
  type ReviewTarget,
  type SarifLog,
} from '@gigadrive/lupe-core';
import { RepoSourceLive, compressDiff, parseUnifiedDiff } from '@gigadrive/lupe-git';
import { GitHubClientLive, anchorFindings } from '@gigadrive/lupe-github';

export type { Finding, LupeAiConfig, SarifLog, ReviewProfile } from '@gigadrive/lupe-core';

export const VERSION = '0.0.0';

/** Shared review knobs for the programmatic API. */
export interface ReviewTuning {
  readonly profile?: ReviewProfile;
  readonly maxFiles?: number;
  readonly maxFindings?: number;
  readonly confidenceThreshold?: number;
  /** Run the grounding verifier (default true). */
  readonly verify?: boolean;
  /** Use the strongest model + extra passes. */
  readonly thorough?: boolean;
  readonly pathFilters?: readonly string[];
}

export interface ReviewResult {
  readonly findings: readonly Finding[];
  readonly summaryMarkdown: string;
  readonly cost: CostSummary;
  /** Render the findings as a SARIF 2.1.0 log. */
  sarif(): SarifLog;
}

const EMPTY_COST: CostSummary = {
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  costUsd: 0,
  byModel: [],
};

function toResult(findings: readonly Finding[], summaryMarkdown: string, cost: CostSummary): ReviewResult {
  return { findings, summaryMarkdown, cost, sarif: () => renderSarif(findings) };
}

const EMPTY_RESULT: ReviewResult = toResult([], '', EMPTY_COST);

// ---------------------------------------------------------------------------
// reviewDiff — review a raw diff or a local git range
// ---------------------------------------------------------------------------

export interface ReviewDiffOptions extends ReviewTuning {
  readonly ai: LupeAiConfig;
  /** Working tree used for the agent's read-only tools (default process.cwd()). */
  readonly rootDir?: string;
  /** A raw unified diff to review… */
  readonly diff?: string;
  /** …or a local git range to diff. */
  readonly base?: string;
  readonly head?: string;
  readonly target?: Partial<ReviewTarget>;
}

/** Review a unified diff (or local git range) and return typed findings. */
export async function reviewDiff(options: ReviewDiffOptions): Promise<ReviewResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const repoLayer = RepoSourceLive({ rootDir });
  const layer = AiSdkLive(options.ai).pipe(Layer.provideMerge(repoLayer));

  const program = Effect.gen(function* () {
    const acquired =
      options.diff !== undefined
        ? parseUnifiedDiff(options.diff)
        : yield* (yield* RepoSource).acquireDiff({
            kind: 'local',
            baseRef: options.base,
            headRef: options.head,
          });

    const compressed = compressDiff(acquired, {
      pathFilters: options.pathFilters,
      maxFilesReviewed: options.maxFiles,
    });
    if (compressed.files.length === 0) return EMPTY_RESULT;

    const target: ReviewTarget = {
      kind: 'local',
      baseRef: options.base,
      headRef: options.head,
      ...options.target,
    };
    const result = yield* runReview(compressed.files, target, {
      profile: options.profile,
      maxFindings: options.maxFindings,
      confidenceThreshold: options.confidenceThreshold,
      verify: options.verify,
      task: options.thorough ? 'deep' : 'review',
    });
    return toResult(result.findings, result.summaryMarkdown, result.cost);
  });

  return Effect.runPromise(program.pipe(Effect.provide(layer)));
}

// ---------------------------------------------------------------------------
// reviewPullRequest — fetch a PR diff, review it, optionally post
// ---------------------------------------------------------------------------

export interface ReviewPullRequestOptions extends ReviewTuning {
  readonly ai: LupeAiConfig;
  readonly github: PullRequestRef & { readonly token: string; readonly baseUrl?: string };
  readonly rootDir?: string;
  readonly headSha?: string;
  /** Post the review back to the PR (default false — review only). */
  readonly post?: boolean;
}

export interface PullRequestReviewResult extends ReviewResult {
  readonly posted: boolean;
}

/** Fetch a GitHub PR diff, review it, and (optionally) post the review. */
export async function reviewPullRequest(options: ReviewPullRequestOptions): Promise<PullRequestReviewResult> {
  const rootDir = options.rootDir ?? process.cwd();
  const pr: PullRequestRef = {
    owner: options.github.owner,
    repo: options.github.repo,
    number: options.github.number,
  };
  const repoLayer = RepoSourceLive({ rootDir });
  const githubLayer = GitHubClientLive({ token: options.github.token, baseUrl: options.github.baseUrl });
  const layer = AiSdkLive(options.ai).pipe(Layer.provideMerge(repoLayer), Layer.provideMerge(githubLayer));

  const program = Effect.gen(function* () {
    const gh = yield* GitHubClient;
    const files = yield* gh.listDiff(pr);
    const compressed = compressDiff(files, {
      pathFilters: options.pathFilters,
      maxFilesReviewed: options.maxFiles,
    });
    if (compressed.files.length === 0) {
      return { ...EMPTY_RESULT, posted: false } satisfies PullRequestReviewResult;
    }

    const result = yield* runReview(
      compressed.files,
      { kind: 'pull_request', repo: pr, pullNumber: pr.number, headSha: options.headSha },
      {
        profile: options.profile,
        maxFindings: options.maxFindings,
        confidenceThreshold: options.confidenceThreshold,
        verify: options.verify,
        task: options.thorough ? 'deep' : 'review',
      }
    );

    let posted = false;
    if (options.post && options.headSha) {
      const { comments } = anchorFindings(result.findings, compressed.files);
      yield* gh.postReview({
        pr,
        headSha: options.headSha,
        comments,
        summaryBody: result.summaryMarkdown,
        resolveStaleThreads: true,
      });
      posted = true;
    }

    return { ...toResult(result.findings, result.summaryMarkdown, result.cost), posted };
  });

  return Effect.runPromise(program.pipe(Effect.provide(layer)));
}
