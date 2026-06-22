import { describe, expect, test } from 'vitest';

import type { AnchoredComment } from '@gigadrive/lupe-core';

import { compareToDiffFiles, toReviewComment } from './client';

describe('toReviewComment', () => {
  test('maps a single-line anchor to line+side (no start_line)', () => {
    const c: AnchoredComment = { anchor: { path: 'a.ts', line: 10, side: 'RIGHT' }, body: 'issue' };
    expect(toReviewComment(c)).toEqual({ path: 'a.ts', body: 'issue', line: 10, side: 'RIGHT' });
  });

  test('maps a multi-line anchor to start_line/start_side + line/side', () => {
    const c: AnchoredComment = {
      anchor: { path: 'a.ts', line: 12, side: 'RIGHT', startLine: 10, startSide: 'RIGHT' },
      body: 'range issue',
    };
    expect(toReviewComment(c)).toEqual({
      path: 'a.ts',
      body: 'range issue',
      line: 12,
      side: 'RIGHT',
      start_line: 10,
      start_side: 'RIGHT',
    });
  });

  test('defaults start_side to side when omitted', () => {
    const c: AnchoredComment = {
      anchor: { path: 'a.ts', line: 5, side: 'LEFT', startLine: 3 },
      body: 'x',
    };
    expect(toReviewComment(c).start_side).toBe('LEFT');
  });
});

describe('compareToDiffFiles (incremental review)', () => {
  test('maps files on a clean fast-forward ("ahead")', () => {
    const files = compareToDiffFiles({
      status: 'ahead',
      files: [{ filename: 'a.ts', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }],
    });
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('a.ts');
  });

  test('returns an empty set when ahead with no files', () => {
    expect(compareToDiffFiles({ status: 'ahead', files: [] })).toEqual([]);
  });

  test('throws on a diverged comparison (rebase/force-push) so the caller falls back to the full diff', () => {
    expect(() => compareToDiffFiles({ status: 'diverged', files: [] })).toThrow(/not fast-forward/);
    expect(() => compareToDiffFiles({ status: 'behind', files: [] })).toThrow(/not fast-forward/);
  });

  test('throws when files are absent', () => {
    expect(() => compareToDiffFiles({ status: 'ahead' })).toThrow(/not fast-forward/);
  });
});
