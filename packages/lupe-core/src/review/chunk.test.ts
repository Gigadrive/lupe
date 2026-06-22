import { describe, expect, test } from 'vitest';

import type { DiffFile } from '../diff';
import { serialiseFileDiff } from '../render/diff-prompt';
import { estimateTokens, planChunks } from './chunk';

function file(path: string, contentLen: number): DiffFile {
  return {
    path,
    status: 'modified',
    binary: false,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: [{ kind: 'add', content: 'x'.repeat(contentLen), newLine: 2 }],
      },
    ],
  };
}

/** Real per-file token cost, so budgets in the tests are robust to serialisation tweaks. */
const cost = (f: DiffFile): number => estimateTokens(serialiseFileDiff(f));

describe('estimateTokens', () => {
  test('≈ chars / 4', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});

describe('planChunks', () => {
  test('packs ranked files into one chunk under budget, preserving order', () => {
    const files = [file('a.ts', 40), file('b.ts', 40), file('c.ts', 40)];
    const budget = files.reduce((n, f) => n + cost(f), 0); // exactly fits
    const plan = planChunks(files, { maxChunkTokens: budget });
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0]!.map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(plan.skipped).toEqual([]);
    expect(plan.oversizedFiles).toEqual([]);
  });

  test('splits into multiple chunks, preserving order', () => {
    const files = [file('a.ts', 40), file('b.ts', 40), file('c.ts', 40)];
    const each = cost(files[0]!);
    const plan = planChunks(files, { maxChunkTokens: each * 2 }); // 2 per chunk
    expect(plan.chunks.map((c) => c.map((f) => f.path))).toEqual([['a.ts', 'b.ts'], ['c.ts']]);
    expect(plan.chunks.flat().map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  test('an oversized single file becomes its own chunk and is flagged', () => {
    const small = file('small.ts', 20);
    const big = file('big.ts', 4000);
    const plan = planChunks([small, big], { maxChunkTokens: cost(small) + 10 });
    expect(plan.oversizedFiles).toEqual(['big.ts']);
    expect(plan.chunks.map((c) => c.map((f) => f.path))).toEqual([['small.ts'], ['big.ts']]);
    expect(plan.skipped).toEqual([]);
  });

  test('reports files beyond the maxChunks ceiling instead of dropping them silently', () => {
    const files = [file('a.ts', 40), file('b.ts', 40), file('c.ts', 40)];
    const plan = planChunks(files, { maxChunkTokens: cost(files[0]!), maxChunks: 2 });
    expect(plan.chunks).toHaveLength(2);
    expect(plan.skipped).toEqual(['c.ts']);
    // nothing is lost — every input file is either chunked or reported as skipped
    const covered = [...plan.chunks.flat().map((f) => f.path), ...plan.skipped].sort();
    expect(covered).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  test('empty input yields no chunks', () => {
    const plan = planChunks([]);
    expect(plan.chunks).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.oversizedFiles).toEqual([]);
  });
});
