import { tool, type ToolSet } from 'ai';
import { Effect } from 'effect';
import { z } from 'zod';

import type { RepoIndexService, RepoSourceService } from '../ports';

/**
 * Read-only repo tools the review agent may call during generation. Each tool
 * runs the corresponding Effect and degrades gracefully (returns a marker
 * string instead of throwing) so a failed read never aborts the loop.
 */
export function buildRepoTools(repo: RepoSourceService, index?: RepoIndexService): ToolSet {
  const tools: ToolSet = {
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

  if (index) {
    tools.findDefinition = tool({
      description:
        'Find the definition(s) of a named symbol (function, class, interface, type, variable) in the repository. Returns path, line, and kind.',
      inputSchema: z.object({
        name: z.string().describe('Symbol name to look up'),
        path: z.string().optional().describe('Optional repository-relative path to scope the search'),
        maxResults: z.number().int().positive().max(20).optional(),
      }),
      execute: ({ name, path, maxResults }) =>
        Effect.runPromise(
          index
            .findDefinitions(name, { path, maxResults: maxResults ?? 10 })
            .pipe(
              Effect.catchAll(() =>
                Effect.succeed<readonly { path: string; name: string; kind: string; line: number }[]>([])
              )
            )
        ),
    });
    tools.findReferences = tool({
      description:
        "Find usages of a named symbol across the repository. Returns 'path:line:snippet' matches. Use to understand the blast radius of a change.",
      inputSchema: z.object({
        name: z.string().describe('Symbol name to look up'),
        path: z.string().optional().describe('Optional repository-relative path to scope the search'),
        maxResults: z.number().int().positive().max(100).optional(),
      }),
      execute: ({ name, path, maxResults }) =>
        Effect.runPromise(
          index
            .findReferences(name, { path, maxResults: maxResults ?? 30 })
            .pipe(Effect.catchAll(() => Effect.succeed<readonly string[]>([])))
        ),
    });
  }

  return tools;
}
