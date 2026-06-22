import { Effect, Layer } from 'effect';

import {
  GitHubClient,
  GitHubError,
  INLINE_MARKER,
  SUMMARY_MARKER,
  parseState,
  type AnchoredComment,
  type ApplyFixInput,
  type ApplyFixesResult,
  type DiffFile,
  type GitHubClientService,
  type PostReviewInput,
  type PullRequestRef,
} from '@gigadrive/lupe-core';
import { buildDiffFile } from '@gigadrive/lupe-git';

import { createOctokit, type LupeOctokit, type OctokitConfig } from './octokit';

/** Map an anchored comment to a GitHub review-comment payload (line/side/start_line). */
export function toReviewComment(c: AnchoredComment): {
  path: string;
  body: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
} {
  return {
    path: c.anchor.path,
    body: c.body,
    line: c.anchor.line,
    side: c.anchor.side,
    ...(c.anchor.startLine !== undefined
      ? { start_line: c.anchor.startLine, start_side: c.anchor.startSide ?? c.anchor.side }
      : {}),
  };
}

function toGitHubError(cause: unknown): GitHubError {
  const status = (cause as { status?: number } | null)?.status;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new GitHubError({ message, status, cause });
}

/** The `compareCommitsWithBasehead` fields we depend on (narrowed for testability). */
export interface CompareResult {
  readonly status: string;
  readonly files?: ReadonlyArray<{
    readonly filename: string;
    readonly previous_filename?: string | null;
    readonly status: string;
    readonly patch?: string;
  }>;
}

/**
 * Map a compare result to DiffFiles, trusting it ONLY when it is a clean
 * fast-forward ("ahead"). Throws otherwise so the incremental caller falls back
 * to the full diff — a rebase/force-push yields "diverged"/"behind".
 */
export function compareToDiffFiles(data: CompareResult): DiffFile[] {
  if (data.status !== 'ahead' || !data.files) {
    throw new Error(`incremental compare not fast-forward (status: ${data.status})`);
  }
  return data.files.map((f) =>
    buildDiffFile({
      filename: f.filename,
      previousFilename: f.previous_filename ?? undefined,
      status: f.status,
      patch: f.patch,
    })
  );
}

const THREADS_QUERY = `query($owner:String!,$repo:String!,$num:Int!,$cursor:String){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$num){
      reviewThreads(first:100, after:$cursor){
        nodes{ id isResolved comments(first:1){ nodes{ body } } }
        pageInfo{ hasNextPage endCursor }
      }
    }
  }
}`;

const RESOLVE_MUTATION = `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id } } }`;

interface ThreadsResponse {
  readonly repository: {
    readonly pullRequest: {
      readonly reviewThreads: {
        readonly nodes: ReadonlyArray<{
          readonly id: string;
          readonly isResolved: boolean;
          readonly comments: { readonly nodes: ReadonlyArray<{ readonly body: string }> };
        }>;
        readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
      };
    };
  };
}

/** Resolve unresolved review threads that lupe authored, so re-reviews start clean. */
async function resolveLupeThreads(octokit: LupeOctokit, pr: PullRequestRef): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    const data = (await octokit.graphql(THREADS_QUERY, {
      owner: pr.owner,
      repo: pr.repo,
      num: pr.number,
      cursor,
    })) as ThreadsResponse;
    const threads = data.repository.pullRequest.reviewThreads;
    for (const thread of threads.nodes) {
      const body = thread.comments.nodes[0]?.body ?? '';
      if (!thread.isResolved && body.includes(INLINE_MARKER)) {
        await octokit.graphql(RESOLVE_MUTATION, { id: thread.id }).catch(() => undefined);
      }
    }
    if (!threads.pageInfo.hasNextPage || !threads.pageInfo.endCursor) break;
    cursor = threads.pageInfo.endCursor;
  }
}

async function findSticky(octokit: LupeOctokit, pr: PullRequestRef): Promise<{ id: number; body: string } | undefined> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const sticky = comments.find((c) => (c.body ?? '').includes(SUMMARY_MARKER));
  return sticky ? { id: sticky.id, body: sticky.body ?? '' } : undefined;
}

export function makeGitHubClient(config: OctokitConfig): GitHubClientService {
  const octokit = createOctokit(config);

  const listDiff = (pr: PullRequestRef): Effect.Effect<readonly DiffFile[], GitHubError> =>
    Effect.tryPromise({
      try: async () => {
        const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
          owner: pr.owner,
          repo: pr.repo,
          pull_number: pr.number,
          per_page: 100,
        });
        return files.map((f) =>
          buildDiffFile({
            filename: f.filename,
            previousFilename: f.previous_filename ?? undefined,
            status: f.status,
            patch: f.patch,
          })
        );
      },
      catch: toGitHubError,
    });

  const listDiffSince = (
    pr: PullRequestRef,
    baseSha: string,
    headSha: string
  ): Effect.Effect<readonly DiffFile[], GitHubError> =>
    Effect.tryPromise({
      try: async () => {
        const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
          owner: pr.owner,
          repo: pr.repo,
          basehead: `${baseSha}...${headSha}`,
          per_page: 100,
        });
        return compareToDiffFiles(data);
      },
      catch: toGitHubError,
    });

  const getLastReviewedSha = (pr: PullRequestRef): Effect.Effect<string | undefined, GitHubError> =>
    Effect.tryPromise({
      try: async () => {
        const sticky = await findSticky(octokit, pr);
        return sticky ? parseState(sticky.body)?.lastReviewedSha : undefined;
      },
      catch: toGitHubError,
    });

  const postReview = (input: PostReviewInput): Effect.Effect<void, GitHubError> =>
    Effect.tryPromise({
      try: async () => {
        if (input.resolveStaleThreads) {
          await resolveLupeThreads(octokit, input.pr).catch(() => undefined);
        }

        if (input.comments.length > 0) {
          await octokit.rest.pulls.createReview({
            owner: input.pr.owner,
            repo: input.pr.repo,
            pull_number: input.pr.number,
            commit_id: input.headSha,
            event: 'COMMENT',
            body: `${INLINE_MARKER} left ${input.comments.length} inline comment(s). See the summary below.`,
            comments: input.comments.map(toReviewComment),
          });
        }

        const sticky = await findSticky(octokit, input.pr);
        if (sticky) {
          await octokit.rest.issues.updateComment({
            owner: input.pr.owner,
            repo: input.pr.repo,
            comment_id: sticky.id,
            body: input.summaryBody,
          });
        } else {
          await octokit.rest.issues.createComment({
            owner: input.pr.owner,
            repo: input.pr.repo,
            issue_number: input.pr.number,
            body: input.summaryBody,
          });
        }
      },
      catch: toGitHubError,
    });

  /** Apply a set of suggestion-based fixes to the PR branch using the Git Data API. */
  const applyFixes = (inputs: readonly ApplyFixInput[]): Effect.Effect<ApplyFixesResult, GitHubError> =>
    Effect.tryPromise({
      try: async () => {
        if (inputs.length === 0) return { applied: [], failed: [] };

        const applied: { path: string; sha: string }[] = [];
        const failed: { path: string; reason: string }[] = [];

        // Group fixes by file path.
        const byPath = new Map<string, ApplyFixInput[]>();
        for (const input of inputs) {
          const list = byPath.get(input.path) ?? [];
          list.push(input);
          byPath.set(input.path, list);
        }

        // Process each file: get content, apply all replacements, commit.
        for (const [path, fixes] of byPath) {
          try {
            // Get the current file content from the PR head.
            const { data: refData } = await octokit.rest.git.getRef({
              owner: inputs[0]!.pr.owner,
              repo: inputs[0]!.pr.repo,
              ref: `heads/${inputs[0]!.pr.repo}/${inputs[0]!.headSha}`,
            });

            // Get the file blob SHA from the tree at headSha.
            const treeSha = (refData.object as { sha: string }).sha;
            const { data: treeData } = await octokit.rest.git.getTree({
              owner: inputs[0]!.pr.owner,
              repo: inputs[0]!.pr.repo,
              tree_sha: treeSha,
              recursive: 'true',
            });

            const entry = (treeData.tree as { path: string; sha: string; type: string }[]).find(
              (e) => e.path === path && e.type === 'blob'
            );
            if (!entry) {
              failed.push({ path, reason: 'file not found in PR branch tree' });
              continue;
            }

            // Get the current file content.
            const { data: blobData } = await octokit.rest.git.getBlob({
              owner: inputs[0]!.pr.owner,
              repo: inputs[0]!.pr.repo,
              file_sha: entry.sha,
            });
            const content = Buffer.from((blobData as { content: string }).content, 'base64').toString('utf8');
            const lines = content.split('\n');

            // Sort fixes by descending line number so we replace from bottom to top.
            const sorted = [...fixes].sort((a, b) => b.startLine - a.startLine);

            for (const fix of sorted) {
              // Adjust for 1-based line numbers.
              const start = fix.startLine - 1;
              const end = fix.endLine;
              const replacementLines = fix.replacement.split('\n');
              lines.splice(start, end - start, ...replacementLines);
            }

            const newContent = lines.join('\n');
            const newContentBase64 = Buffer.from(newContent, 'utf8').toString('base64');

            // Create a new blob.
            const { data: newBlob } = await octokit.rest.git.createBlob({
              owner: inputs[0]!.pr.owner,
              repo: inputs[0]!.pr.repo,
              content: newContentBase64,
              encoding: 'base64',
            });

            // Build a new tree with the updated blob.
            const { data: newTree } = await octokit.rest.git.createTree({
              owner: inputs[0]!.pr.owner,
              repo: inputs[0]!.pr.repo,
              base_tree: treeSha,
              tree: [{ path, mode: '100644', type: 'blob', sha: (newBlob as { sha: string }).sha }],
            });

            // Get the current commit to use as parent.
            const commitSha = treeSha;

            // Create a new commit.
            const { data: newCommit } = await octokit.rest.git.createCommit({
              owner: inputs[0]!.pr.owner,
              repo: inputs[0]!.pr.repo,
              message: fixes.map((f) => f.message).join('\n---\n'),
              tree: (newTree as { sha: string }).sha,
              parents: [commitSha],
            });

            // Update the PR branch ref to the new commit.
            await octokit.rest.git.updateRef({
              owner: inputs[0]!.pr.owner,
              repo: inputs[0]!.pr.repo,
              ref: `heads/${inputs[0]!.pr.repo}/${inputs[0]!.headSha}`,
              sha: (newCommit as { sha: string }).sha,
              force: false,
            });

            applied.push({ path, sha: (newCommit as { sha: string }).sha });
          } catch (err) {
            failed.push({ path, reason: err instanceof Error ? err.message : String(err) });
          }
        }

        return { applied, failed };
      },
      catch: toGitHubError,
    });

  return { listDiff, listDiffSince, getLastReviewedSha, postReview, applyFixes };
}

/** Effect Layer providing the GitHub transport for a token. */
export function GitHubClientLive(config: OctokitConfig): Layer.Layer<GitHubClient> {
  return Layer.sync(GitHubClient, () => makeGitHubClient(config));
}
