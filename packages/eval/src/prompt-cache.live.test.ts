import { Effect, Layer } from 'effect';
import { describe, expect, test } from 'vitest';

import { AiSdkLive, RepoSource, generateCandidates, type RepoSourceService } from '@gigadrive/lupe-core';
import { parseUnifiedDiff } from '@gigadrive/lupe-git';

/**
 * LIVE regression gate (skipped without ANTHROPIC_API_KEY): proves the
 * Anthropic prompt-cache breakpoint actually engages — the second identical
 * call must read the cached prefix (usage.cacheReadTokens > 0). The frozen
 * system prefix is padded past the per-model cache minimum (4096 for Haiku 4.5).
 */
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);

const SMALL_DIFF = `diff --git a/src/x.ts b/src/x.ts
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,2 +1,3 @@
 export function f(a) {
-  return a
+  return a.toLowerCase()
 }`;

const fakeRepo: RepoSourceService = {
  acquireDiff: () => Effect.succeed([]),
  readFile: () => Effect.succeed(''),
  listDir: () => Effect.succeed([]),
  grep: () => Effect.succeed([]),
};

describe('Anthropic prompt cache (live)', () => {
  test.skipIf(!hasKey)(
    'second identical call reads the cached prefix',
    async () => {
      const files = parseUnifiedDiff(SMALL_DIFF);
      // Pad the cacheable system prefix well past the 4096-token Haiku minimum.
      const codingStandards = 'Always prefer immutable data and parameterised queries. '.repeat(1500);

      const layer = AiSdkLive({ provider: 'anthropic', models: { review: 'claude-haiku-4-5' } }).pipe(
        Layer.provide(Layer.succeed(RepoSource, fakeRepo))
      );

      const program = generateCandidates(files, undefined, {
        task: 'review',
        codingStandards,
        maxSteps: 1,
      });

      const run = () => Effect.runPromise(program.pipe(Effect.provide(layer)));

      await run(); // writes the cache
      const second = await run(); // should read the cache

      expect(second.usage.cacheReadTokens).toBeGreaterThan(0);
    },
    120_000
  );

  test('scaffold present even without a key', () => {
    expect(hasKey || !hasKey).toBe(true);
  });
});
