import { Effect, Layer } from "effect";
import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import {
  DiffParseError,
  RepoSource,
  type DiffFile,
  type RepoSourceService,
  type ReviewTarget,
} from "@gigadrive/lupe-core";
import { parseUnifiedDiff } from "./parse";

export interface RepoSourceConfig {
  /** Absolute path to the repository working tree. */
  readonly rootDir: string;
}

function fail(message: string, cause?: unknown): DiffParseError {
  return new DiffParseError({ message, cause });
}

/** Build a read-only RepoSource backed by the local git working tree. */
export function makeRepoSource(config: RepoSourceConfig): RepoSourceService {
  const git: SimpleGit = simpleGit({ baseDir: config.rootDir });
  const resolve = (p: string): string => nodePath.resolve(config.rootDir, p);

  const acquireDiff = (target: ReviewTarget): Effect.Effect<readonly DiffFile[], DiffParseError> =>
    Effect.tryPromise({
      try: async () => {
        const head = target.headRef ?? target.headSha ?? "HEAD";
        const base = target.baseRef ?? target.baseSha;
        const args = base ? [`${base}...${head}`] : ["HEAD"];
        const raw = await git.diff(args);
        return parseUnifiedDiff(raw);
      },
      catch: (cause) => fail("failed to acquire git diff", cause),
    });

  const readFile = (path: string): Effect.Effect<string, DiffParseError> =>
    Effect.tryPromise({
      try: () => fs.readFile(resolve(path), "utf8"),
      catch: (cause) => fail(`failed to read ${path}`, cause),
    });

  const listDir = (path: string): Effect.Effect<readonly string[], DiffParseError> =>
    Effect.tryPromise({
      try: async () => {
        const entries = await fs.readdir(resolve(path), { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      },
      catch: (cause) => fail(`failed to list ${path}`, cause),
    });

  const grep = (
    pattern: string,
    options?: { readonly glob?: string; readonly maxResults?: number },
  ): Effect.Effect<readonly string[], DiffParseError> =>
    Effect.tryPromise({
      try: async () => {
        const args = ["grep", "-n", "-I", "-E", pattern];
        if (options?.glob) args.push("--", options.glob);
        try {
          const out = await git.raw(args);
          const lines = out.split("\n").filter((l) => l.length > 0);
          return options?.maxResults ? lines.slice(0, options.maxResults) : lines;
        } catch {
          // `git grep` exits non-zero when there are no matches.
          return [];
        }
      },
      catch: (cause) => fail(`failed to grep ${pattern}`, cause),
    });

  return { acquireDiff, readFile, listDir, grep };
}

/** Effect Layer providing RepoSource for a given working tree. */
export function RepoSourceLive(config: RepoSourceConfig): Layer.Layer<RepoSource> {
  return Layer.succeed(RepoSource, makeRepoSource(config));
}
