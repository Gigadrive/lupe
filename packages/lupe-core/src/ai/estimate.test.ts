import { describe, expect, test } from 'vitest';

import type { DiffFile } from '../diff';
import { estimateGenerationCostUsd } from './estimate';

function mkFile(path: string): DiffFile {
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
        newLines: 1,
        lines: [{ kind: 'add', content: 'const x = 1;'.repeat(50), newLine: 1 }],
      },
    ],
  };
}

const SYSTEM = 'SYSTEM PREFIX '.repeat(400); // ~1400 tokens

describe('estimateGenerationCostUsd', () => {
  test('prices a single chunk (cache write on the system prefix) for a known model', () => {
    const est = estimateGenerationCostUsd({ system: SYSTEM, chunks: [[mkFile('a.ts')]], modelId: 'claude-opus-4-8' });
    expect(est.known).toBe(true);
    expect(est.estimatedUsd).toBeGreaterThan(0);
  });

  test('N chunks cost more than one (cache reads + more diff input)', () => {
    const one = estimateGenerationCostUsd({ system: SYSTEM, chunks: [[mkFile('a.ts')]], modelId: 'claude-opus-4-8' });
    const three = estimateGenerationCostUsd({
      system: SYSTEM,
      chunks: [[mkFile('a.ts')], [mkFile('b.ts')], [mkFile('c.ts')]],
      modelId: 'claude-opus-4-8',
    });
    expect(three.estimatedUsd).toBeGreaterThan(one.estimatedUsd);
  });

  test('unknown model → known:false and zero estimate', () => {
    const est = estimateGenerationCostUsd({ system: SYSTEM, chunks: [[mkFile('a.ts')]], modelId: 'mystery' });
    expect(est.known).toBe(false);
    expect(est.estimatedUsd).toBe(0);
  });

  test('overrides make an otherwise-unknown model known and priced', () => {
    const est = estimateGenerationCostUsd({
      system: SYSTEM,
      chunks: [[mkFile('a.ts')]],
      modelId: 'mystery',
      overrides: { mystery: { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 } },
    });
    expect(est.known).toBe(true);
    expect(est.estimatedUsd).toBeGreaterThan(0);
  });
});
