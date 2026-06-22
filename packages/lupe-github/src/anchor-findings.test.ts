import { describe, expect, test } from 'vitest';

import type { DiffFile, Finding } from '@gigadrive/lupe-core';

import { anchorFindings } from './anchor-findings';

// One added line (newLine 2) on RIGHT.
const FILE: DiffFile = {
  path: 'a.ts',
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
      lines: [
        { kind: 'context', content: 'a', oldLine: 1, newLine: 1 },
        { kind: 'add', content: 'b', newLine: 2 },
      ],
    },
  ],
};

function finding(o: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'lupe/correctness/x',
    title: 't',
    path: 'a.ts',
    startLine: 2,
    endLine: 2,
    side: 'RIGHT',
    severity: 'high',
    category: 'correctness',
    message: 'm',
    confidence: 0.9,
    evidence: [],
    ...o,
  };
}

describe('anchorFindings', () => {
  test('anchors findings on diff lines and renders an inline body', () => {
    const { comments, unanchored } = anchorFindings([finding()], [FILE]);
    expect(comments).toHaveLength(1);
    expect(unanchored).toHaveLength(0);
    expect(comments[0]!.anchor).toMatchObject({ path: 'a.ts', line: 2, side: 'RIGHT' });
    expect(comments[0]!.body).toContain('🔍 lupe');
  });

  test('routes findings off the diff to unanchored (avoids 422)', () => {
    const { comments, unanchored } = anchorFindings([finding({ startLine: 99, endLine: 99 })], [FILE]);
    expect(comments).toHaveLength(0);
    expect(unanchored).toHaveLength(1);
  });

  test('handles findings for files not in the diff', () => {
    const { unanchored } = anchorFindings([finding({ path: 'other.ts' })], [FILE]);
    expect(unanchored).toHaveLength(1);
  });
});
