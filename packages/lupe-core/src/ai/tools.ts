import { tool, type ToolSet } from 'ai';
import { Effect } from 'effect';
import { z } from 'zod';

import type { RepoSourceService } from '../ports';

/**
 * Read-only repo tools the review agent may call during generation. Each tool
 * runs the corresponding RepoSource Effect and degrades gracefully (returns a
 * marker string instead of throwing) so a failed read never aborts the loop.
 */
export function buildRepoTools(repo: RepoSourceService): ToolSet {
  return {
    readFile: tool({
      description: 'Read the full contents of a file in the repository at the head revision.',
      inputSchema: z.object({ path: z.string().describe('Repository-relative file path') }),
      execute: ({ path }) =>
        Effect.runPromise(
          repo.readFile(path).pipe(Effect.catchAll(() => Effect.succeed(`<error: could not read ${path}>`)))
        ),
    }),
    listDir: tool({
      description: "List entries of a directory (non-recursive). Directory names end with '/'.",
      inputSchema: z.object({ path: z.string().describe('Repository-relative directory path') }),
      execute: ({ path }) =>
        Effect.runPromise(repo.listDir(path).pipe(Effect.catchAll(() => Effect.succeed<readonly string[]>([])))),
    }),
    grep: tool({
      description:
        "Search the repository for an extended POSIX regex. Returns 'path:line:text' matches. Use to find callers, definitions, and related code outside the diff.",
      inputSchema: z.object({
        pattern: z.string().describe('Extended regex'),
        glob: z.string().optional().describe('Optional pathspec to scope the search'),
        maxResults: z.number().int().positive().max(200).optional(),
      }),
      execute: ({ pattern, glob, maxResults }) =>
        Effect.runPromise(
          repo
            .grep(pattern, { glob, maxResults: maxResults ?? 50 })
            .pipe(Effect.catchAll(() => Effect.succeed<readonly string[]>([])))
        ),
    }),
  };
}
