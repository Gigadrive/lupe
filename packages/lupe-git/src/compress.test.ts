import { describe, expect, test } from 'vitest';

import { compressDiff, estimateTokens, isGenerated, isLockfile, matchesFilters, serialiseFileDiff } from './compress';
import { parseUnifiedDiff } from './parse';

describe('file classification', () => {
  test('isLockfile', () => {
    expect(isLockfile('pnpm-lock.yaml')).toBe(true);
    expect(isLockfile('packages/x/package-lock.json')).toBe(true);
    expect(isLockfile('src/index.ts')).toBe(false);
  });

  test('isGenerated', () => {
    expect(isGenerated('dist/index.js')).toBe(true);
    expect(isGenerated('packages/a/build/x.js')).toBe(true);
    expect(isGenerated('app.min.js')).toBe(true);
    expect(isGenerated('src/index.ts')).toBe(false);
    // ORM-generated migration metadata is noise; the .sql migration itself is not.
    expect(isGenerated('packages/common/drizzle/meta/0027_snapshot.json')).toBe(true);
    expect(isGenerated('packages/common/drizzle/meta/_journal.json')).toBe(true);
    expect(isGenerated('packages/common/drizzle/0027_tiny_chat.sql')).toBe(false);
  });

  test('matchesFilters honours include/exclude with last-match-wins', () => {
    expect(matchesFilters('src/index.ts', ['!**/*.ts'])).toBe(false);
    expect(matchesFilters('src/index.ts', ['!**/*.ts', 'src/**'])).toBe(true);
    expect(matchesFilters('docs/readme.md', [])).toBe(true);
  });
});

describe('estimateTokens', () => {
  test('≈ chars/4', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});

const FILES = parseUnifiedDiff(
  [
    `diff --git a/src/feature.ts b/src/feature.ts
--- a/src/feature.ts
+++ b/src/feature.ts
@@ -1,1 +1,2 @@
 const a = 1
+const b = 2`,
    `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1,1 +1,2 @@
 lockfileVersion: 9
+newdep: 1`,
    `diff --git a/dist/bundle.js b/dist/bundle.js
--- a/dist/bundle.js
+++ b/dist/bundle.js
@@ -1,1 +1,2 @@
 x
+y`,
    `diff --git a/logo.png b/logo.png
new file mode 100644
Binary files /dev/null and b/logo.png differ`,
  ].join('\n')
);

describe('compressDiff', () => {
  test('drops lockfiles, generated, and binary files', () => {
    const result = compressDiff(FILES);
    expect(result.files.map((f) => f.path)).toEqual(['src/feature.ts']);
    const reasons = Object.fromEntries(result.dropped.map((d) => [d.path, d.reason]));
    expect(reasons['pnpm-lock.yaml']).toBe('lockfile');
    expect(reasons['dist/bundle.js']).toBe('generated');
    expect(reasons['logo.png']).toBe('binary');
  });

  test('respects path filters', () => {
    const result = compressDiff(FILES, { pathFilters: ['!src/**'] });
    expect(result.files.find((f) => f.path === 'src/feature.ts')).toBeUndefined();
  });

  test('enforces the token budget', () => {
    const result = compressDiff(FILES, { maxTokens: 1 });
    // first file always included even if over budget; nothing else fits
    expect(result.files).toHaveLength(1);
  });

  test('chunk mode does file selection only and never drops for token budget', () => {
    // maxTokens that would normally truncate is ignored in chunk mode — the
    // engine's chunked review handles the budget instead of dropping silently.
    const result = compressDiff(FILES, { maxTokens: 1, chunk: true });
    expect(result.truncated).toBe(false);
    expect(result.files.map((f) => f.path)).toEqual(['src/feature.ts']); // content drops still apply
    expect(result.dropped.some((d) => d.reason === 'budget')).toBe(false);
  });

  test('serialiseFileDiff includes head line numbers', () => {
    const s = serialiseFileDiff(FILES[0]!);
    expect(s).toContain('src/feature.ts');
    expect(s).toContain('+');
  });
});
