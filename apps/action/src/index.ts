import { existsSync, readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import * as core from '@actions/core';
import * as github from '@actions/github';
import { Effect, Layer } from 'effect';
import { parse as parseYaml } from 'yaml';

import {
  AiSdkLive,
  findingsForInlineComment,
  GitHubClient,
  normalizeConfig,
  runReview,
  SEVERITY_RANK,
  type ApiProviderId,
  type LupeConfig,
  type ReviewProfile,
  type ReviewTarget,
  type Severity,
} from '@gigadrive/lupe-core';
import { compressDiff, discoverCodingStandards, RepoIndexLive, RepoSourceLive } from '@gigadrive/lupe-git';
import { anchorFindings, GitHubClientLive } from '@gigadrive/lupe-github';

const FAIL_NONE = 'none';

function intInput(name: string): number | undefined {
  const raw = core.getInput(name);
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function numInput(name: string): number | undefined {
  const raw = core.getInput(name);
  if (!raw) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function boolInput(name: string): boolean | undefined {
  const raw = core.getInput(name).trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function severityInput(name: string): Severity | undefined {
  const raw = core.getInput(name).trim().toLowerCase();
  return raw && raw in SEVERITY_RANK ? (raw as Severity) : undefined;
}

function parseProfile(raw: string): ReviewProfile | undefined {
  return raw === 'assertive' ? 'assertive' : raw === 'chill' ? 'chill' : undefined;
}

function parseModels(raw: string): Record<string, string> | undefined {
  if (!raw.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : undefined;
  } catch {
    core.warning(`lupe: could not parse "models" input as JSON; ignoring.`);
    return undefined;
  }
}

/** Read a repo-committed `.lupe.yaml` from the checkout; Action inputs override it. */
function loadActionConfig(workspace: string): LupeConfig {
  for (const name of ['.lupe.yaml', '.lupe.yml']) {
    const file = nodePath.join(workspace, name);
    if (!existsSync(file)) continue;
    try {
      const parsed = parseYaml(readFileSync(file, 'utf8'));
      return normalizeConfig((parsed as Record<string, unknown> | null) ?? {});
    } catch (error) {
      core.warning(`lupe: failed to parse ${name}; ignoring. ${error instanceof Error ? error.message : ''}`);
      return normalizeConfig({});
    }
  }
  return normalizeConfig({});
}

const program = Effect.gen(function* () {
  const ctx = github.context;
  const pr = ctx.payload.pull_request;
  if (!pr) {
    core.info('lupe: no pull_request in the event payload; skipping.');
    return;
  }
  if (ctx.eventName === 'pull_request_target') {
    core.warning(
      'lupe: running on pull_request_target — do NOT check out untrusted PR code in this job (RCE/secret-exfil risk).'
    );
  }

  const owner = ctx.repo.owner;
  const repo = ctx.repo.repo;
  const number = pr.number as number;
  const headSha = (pr.head?.sha as string | undefined) ?? ctx.sha;
  const baseSha = pr.base?.sha as string | undefined;
  const isDraft = Boolean(pr.draft);

  if (isDraft && core.getInput('skip-draft') !== 'false') {
    core.info('lupe: draft PR; skipping (set skip-draft: false to review drafts).');
    return;
  }

  const token = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';
  if (!token) {
    core.setFailed('lupe: no github-token available.');
    return;
  }

  const prRef = { owner, repo, number };
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  // `.lupe.yaml` from the checked-out repo is the base; explicit Action inputs win.
  const config = loadActionConfig(workspace);

  const provider = (core.getInput('provider') || config.provider || 'anthropic') as ApiProviderId;
  const profile: ReviewProfile | undefined = parseProfile(core.getInput('profile')) ?? config.profile;
  const models = parseModels(core.getInput('models')) ?? config.models;
  const baseURL = core.getInput('base-url') || config.baseURL || undefined;
  const maxFiles = intInput('max-files') ?? config.maxFiles;
  const maxFindings = intInput('max-findings') ?? config.maxFindings;
  const confidenceThreshold = numInput('confidence-threshold') ?? config.confidenceThreshold;
  const suppressAdvisory = boolInput('suppress-advisory') ?? config.suppressAdvisory;
  const minSeverityToComment = severityInput('min-severity-to-comment') ?? config.minSeverityToComment;
  const maxChunkTokens = intInput('max-chunk-tokens') ?? config.maxChunkTokens;
  const maxChunks = intInput('max-chunks') ?? config.maxChunks;
  const reviewConcurrency = intInput('review-concurrency') ?? config.reviewConcurrency;
  const thorough = (core.getInput('thorough') || 'false') === 'true';
  const failOn = (core.getInput('fail-on-severity') || FAIL_NONE).toLowerCase();
  const codingStandards = discoverCodingStandards({ rootDir: workspace, explicit: config.codingStandards });

  const repoLayer = RepoSourceLive({ rootDir: workspace });
  const indexLayer = RepoIndexLive({ rootDir: workspace });
  const aiLayer = AiSdkLive({ provider, models, baseURL }).pipe(Layer.provide(repoLayer), Layer.provide(indexLayer));
  const githubLayer = GitHubClientLive({ token });
  const layer = Layer.mergeAll(aiLayer, githubLayer);

  const run = Effect.gen(function* () {
    const gh = yield* GitHubClient;
    const lastReviewedSha = yield* gh.getLastReviewedSha(prRef);
    // Incremental: only review commits since the last reviewed SHA. Fall back to
    // the full diff on the first review or any non-fast-forward (rebase/force-push).
    const incremental = lastReviewedSha !== undefined && lastReviewedSha !== headSha;
    const files = incremental
      ? yield* gh.listDiffSince(prRef, lastReviewedSha, headSha).pipe(Effect.catchAll(() => gh.listDiff(prRef)))
      : yield* gh.listDiff(prRef);
    if (incremental) core.info(`lupe: incremental review since ${lastReviewedSha.slice(0, 7)}.`);
    const compressed = compressDiff(files, {
      pathFilters: config.pathFilters,
      maxFilesReviewed: maxFiles,
      chunk: true,
    });
    if (compressed.files.length === 0) {
      core.info('lupe: no reviewable changes.');
      return;
    }

    const target: ReviewTarget = {
      kind: 'pull_request',
      repo: { owner, repo },
      pullNumber: number,
      headSha,
      baseSha,
      title: pr.title as string | undefined,
      body: (pr.body as string | null | undefined) ?? undefined,
      lastReviewedSha,
      isDraft,
    };

    const result = yield* runReview(compressed.files, target, {
      profile,
      codingStandards,
      pathInstructions: config.pathInstructions,
      confidenceThreshold,
      categoryThresholds: config.categoryThresholds,
      pathThresholds: config.pathThresholds,
      suppressAdvisory,
      maxFindings,
      maxChunkTokens,
      maxChunks,
      reviewConcurrency,
      verify: true,
      task: thorough ? 'deep' : 'review',
    });

    const inline = findingsForInlineComment(result.findings, minSeverityToComment);
    const { comments, unanchored } = anchorFindings(inline, compressed.files);
    yield* gh.postReview({
      pr: prRef,
      headSha,
      comments,
      summaryBody: result.summaryMarkdown,
      resolveStaleThreads: true,
    });

    core.setOutput('findings', String(result.findings.length));
    core.setOutput('cost-usd', result.cost.costUsd.toFixed(4));
    core.setOutput('skipped', String(result.skippedForSize.length));
    const passes = result.chunkCount > 1 ? ` · ${result.chunkCount} passes` : '';
    core.info(
      `lupe: ${result.findings.length} findings (${comments.length} inline, ${unanchored.length} summary-only) · ~$${result.cost.costUsd.toFixed(
        4
      )}${passes}`
    );
    if (result.skippedForSize.length > 0) {
      core.warning(
        `lupe: ${result.skippedForSize.length} changed file(s) NOT reviewed (size budget): ` +
          `${result.skippedForSize.join(', ')}. Raise max-chunks, narrow the diff, or split the PR.`
      );
    }

    if (failOn !== FAIL_NONE) {
      const threshold = SEVERITY_RANK[failOn as Severity];
      if (threshold !== undefined) {
        const blocking = result.findings.filter((f) => SEVERITY_RANK[f.severity] <= threshold);
        if (blocking.length > 0) {
          core.setFailed(`lupe: ${blocking.length} finding(s) at or above severity "${failOn}".`);
        }
      }
    }
  });

  yield* run.pipe(Effect.provide(layer));
});

Effect.runPromise(
  program.pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => core.setFailed(`lupe failed: ${(error as { message?: string }).message ?? String(error)}`))
    )
  )
).catch((error) => core.setFailed(`lupe crashed: ${error instanceof Error ? error.message : String(error)}`));
