import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';

import { Effect, Layer } from 'effect';

import { DiffParseError, RepoIndex, type RepoIndexService, type RepoSymbol } from '@gigadrive/lupe-core';

export interface RepoIndexConfig {
  /** Absolute path to the repository working tree. */
  readonly rootDir: string;
}

const TS_LIKE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const DEFINITION_PATTERNS: { readonly kind: RepoSymbol['kind']; readonly re: RegExp }[] = [
  { kind: 'function', re: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/g },
  { kind: 'function', re: /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/g },
  { kind: 'function', re: /(?:export\s+)?const\s+(\w+)\s*=\s*function\b/g },
  { kind: 'class', re: /(?:export\s+)?class\s+(\w+)\b/g },
  { kind: 'interface', re: /(?:export\s+)?interface\s+(\w+)\b/g },
  { kind: 'type', re: /(?:export\s+)?type\s+(\w+)\b/g },
  { kind: 'method', re: /(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/g },
];

function fail(message: string, cause?: unknown): DiffParseError {
  return new DiffParseError({ message, cause });
}

function parseDefinitions(path: string, content: string): RepoSymbol[] {
  const byName = new Map<string, RepoSymbol>();
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip comments and strings.
    const code = line.replace(/['"`][^'"`]*['"`]/g, "'");
    for (const { kind, re } of DEFINITION_PATTERNS) {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(code)) !== null) {
        const name = m[1]!;
        // Prefer the earliest line for a given name in this file.
        if (!byName.has(name)) {
          byName.set(name, { path, name, kind, line: i + 1 });
        }
      }
    }
  }

  return [...byName.values()];
}

async function collectSourceFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const name = entry.name;
        if (name === 'node_modules' || name === '.git' || name === 'dist' || name.startsWith('.')) continue;
        await walk(nodePath.join(dir, name));
      } else if (TS_LIKE.test(entry.name)) {
        out.push(nodePath.relative(rootDir, nodePath.join(dir, entry.name)));
      }
    }
  }
  await walk(rootDir);
  return out;
}

function makeResolver(rootDir: string): { resolve: (p: string) => string } {
  return { resolve: (p: string) => nodePath.resolve(rootDir, p) };
}

export function makeRepoIndex(config: RepoIndexConfig): RepoIndexService {
  const { resolve } = makeResolver(config.rootDir);
  let definitionsPromise: Promise<Map<string, RepoSymbol[]>> | undefined;

  async function definitions(): Promise<Map<string, RepoSymbol[]>> {
    if (definitionsPromise) return definitionsPromise;
    definitionsPromise = (async () => {
      const paths = await collectSourceFiles(config.rootDir);
      const map = new Map<string, RepoSymbol[]>();
      for (const p of paths) {
        try {
          const content = await fs.readFile(resolve(p), 'utf8');
          for (const symbol of parseDefinitions(p, content)) {
            const list = map.get(symbol.name) ?? [];
            list.push(symbol);
            map.set(symbol.name, list);
          }
        } catch {
          // Ignore unreadable files.
        }
      }
      return map;
    })();
    return definitionsPromise;
  }

  const findDefinitions = (
    name: string,
    options?: { readonly path?: string; readonly maxResults?: number }
  ): Effect.Effect<readonly RepoSymbol[], DiffParseError> =>
    Effect.tryPromise({
      try: async () => {
        const defs = await definitions();
        let list = defs.get(name) ?? [];
        if (options?.path) {
          const normalized = options.path.replace(/\\/g, '/');
          list = list.filter((s) => s.path === normalized || s.path.endsWith(`/${normalized}`));
        }
        return options?.maxResults ? list.slice(0, options.maxResults) : list;
      },
      catch: (cause) => fail(`failed to look up definition for ${name}`, cause),
    });

  const findReferences = (
    name: string,
    options?: { readonly path?: string; readonly maxResults?: number }
  ): Effect.Effect<readonly string[], DiffParseError> =>
    Effect.tryPromise({
      try: async () => {
        // Escape the name for safe regex use.
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${escaped}\\b`, 'g');
        const paths = options?.path ? [options.path] : await collectSourceFiles(config.rootDir);
        const matches: string[] = [];
        const limit = options?.maxResults ?? 50;
        for (const p of paths) {
          if (matches.length >= limit) break;
          try {
            const content = await fs.readFile(resolve(p), 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && matches.length < limit; i++) {
              re.lastIndex = 0;
              if (re.test(lines[i]!)) {
                matches.push(`${p}:${i + 1}:${lines[i]!.trim()}`);
              }
            }
          } catch {
            // Ignore unreadable files.
          }
        }
        return matches;
      },
      catch: (cause) => fail(`failed to find references for ${name}`, cause),
    });

  return { findDefinitions, findReferences };
}

/** Effect Layer providing RepoIndex for a given working tree. */
export function RepoIndexLive(config: RepoIndexConfig): Layer.Layer<RepoIndex> {
  return Layer.succeed(RepoIndex, makeRepoIndex(config));
}
