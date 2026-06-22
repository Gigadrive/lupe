import * as core from "@actions/core";
import * as github from "@actions/github";
import { Effect, Layer } from "effect";
import {
  AiSdkLive,
  GitHubClient,
  SEVERITY_RANK,
  runReview,
  type ApiProviderId,
  type ReviewProfile,
  type ReviewTarget,
  type Severity,
} from "@gigadrive/lupe-core";
import { RepoSourceLive, compressDiff } from "@gigadrive/lupe-git";
import { GitHubClientLive, anchorFindings } from "@gigadrive/lupe-github";

const FAIL_NONE = "none";

function intInput(name: string): number | undefined {
  const raw = core.getInput(name);
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseModels(raw: string): Record<string, string> | undefined {
  if (!raw.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : undefined;
  } catch {
    core.warning(`lupe: could not parse "models" input as JSON; ignoring.`);
    return undefined;
  }
}

const program = Effect.gen(function* () {
  const ctx = github.context;
  const pr = ctx.payload.pull_request;
  if (!pr) {
    core.info("lupe: no pull_request in the event payload; skipping.");
    return;
  }
  if (ctx.eventName === "pull_request_target") {
    core.warning(
      "lupe: running on pull_request_target — do NOT check out untrusted PR code in this job (RCE/secret-exfil risk).",
    );
  }

  const owner = ctx.repo.owner;
  const repo = ctx.repo.repo;
  const number = pr.number as number;
  const headSha = (pr.head?.sha as string | undefined) ?? ctx.sha;
  const baseSha = pr.base?.sha as string | undefined;
  const isDraft = Boolean(pr.draft);

  if (isDraft && core.getInput("skip-draft") !== "false") {
    core.info("lupe: draft PR; skipping (set skip-draft: false to review drafts).");
    return;
  }

  const token = core.getInput("github-token") || process.env.GITHUB_TOKEN || "";
  if (!token) {
    core.setFailed("lupe: no github-token available.");
    return;
  }

  const provider = (core.getInput("provider") || "anthropic") as ApiProviderId;
  const profileIn = core.getInput("profile");
  const profile: ReviewProfile | undefined =
    profileIn === "assertive" ? "assertive" : profileIn === "chill" ? "chill" : undefined;
  const models = parseModels(core.getInput("models"));
  const baseURL = core.getInput("base-url") || undefined;
  const maxFiles = intInput("max-files");
  const maxFindings = intInput("max-findings");
  const thorough = (core.getInput("thorough") || "false") === "true";
  const failOn = (core.getInput("fail-on-severity") || FAIL_NONE).toLowerCase();

  const prRef = { owner, repo, number };
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();

  const repoLayer = RepoSourceLive({ rootDir: workspace });
  const aiLayer = AiSdkLive({ provider, models, baseURL }).pipe(Layer.provide(repoLayer));
  const githubLayer = GitHubClientLive({ token });
  const layer = Layer.mergeAll(repoLayer, aiLayer, githubLayer);

  const run = Effect.gen(function* () {
    const gh = yield* GitHubClient;
    const lastReviewedSha = yield* gh.getLastReviewedSha(prRef);
    const files = yield* gh.listDiff(prRef);
    const compressed = compressDiff(files, { maxFilesReviewed: maxFiles });
    if (compressed.files.length === 0) {
      core.info("lupe: no reviewable changes.");
      return;
    }

    const target: ReviewTarget = {
      kind: "pull_request",
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
      maxFindings,
      verify: true,
      task: thorough ? "deep" : "review",
    });

    const { comments, unanchored } = anchorFindings(result.findings, compressed.files);
    yield* gh.postReview({
      pr: prRef,
      headSha,
      comments,
      summaryBody: result.summaryMarkdown,
      resolveStaleThreads: true,
    });

    core.setOutput("findings", String(result.findings.length));
    core.setOutput("cost-usd", result.cost.costUsd.toFixed(4));
    core.info(
      `lupe: ${result.findings.length} findings (${comments.length} inline, ${unanchored.length} summary-only) · ~$${result.cost.costUsd.toFixed(
        4,
      )}`,
    );

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
      Effect.sync(() =>
        core.setFailed(`lupe failed: ${(error as { message?: string }).message ?? String(error)}`),
      ),
    ),
  ),
).catch((error) => core.setFailed(`lupe crashed: ${error instanceof Error ? error.message : String(error)}`));
