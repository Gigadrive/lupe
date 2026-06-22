import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';

import { Effect } from 'effect';

import { ConfigError } from '@gigadrive/lupe-core';

/**
 * A minimal, file-based learnings store (`.lupe/learnings.json`). Patterns added
 * here are fed to BOTH the review prompt (so the model avoids them) and the
 * filter chain (so any that slip through are suppressed). A future version can
 * swap this for an embedding-based similarity store behind the same shape.
 */

const STORE_DIR = '.lupe';
const STORE_FILE = 'learnings.json';

interface LearningsData {
  suppress: string[];
}

function storePath(cwd: string): string {
  return nodePath.join(cwd, STORE_DIR, STORE_FILE);
}

async function readData(path: string): Promise<LearningsData> {
  if (!existsSync(path)) return { suppress: [] };
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<LearningsData>;
    return { suppress: Array.isArray(parsed.suppress) ? parsed.suppress : [] };
  } catch {
    return { suppress: [] };
  }
}

/** Load suppression patterns; never fails (missing/corrupt → no learnings). */
export function loadLearnings(cwd: string): Effect.Effect<readonly string[]> {
  return Effect.promise(async () => (await readData(storePath(cwd))).suppress);
}

/** Record a new suppression pattern. */
export function addLearning(cwd: string, pattern: string): Effect.Effect<void, ConfigError> {
  return Effect.tryPromise({
    try: async () => {
      await fs.mkdir(nodePath.join(cwd, STORE_DIR), { recursive: true });
      const path = storePath(cwd);
      const data = await readData(path);
      if (!data.suppress.includes(pattern)) data.suppress.push(pattern);
      await fs.writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    },
    catch: (cause) => new ConfigError({ message: 'failed to write learnings', cause }),
  });
}
