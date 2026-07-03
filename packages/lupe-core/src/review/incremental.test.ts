import { describe, expect, test } from 'vitest';

import type { Finding } from '../finding';
import type { FindingDigest } from '../render/markdown';
import { mergeIncrementalFindings } from './incremental';

function finding(o: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'lupe/correctness/x',
    title: 't',
    path: 'a.ts',
    startLine: 1,
    endLine: 1,
    side: 'RIGHT',
    severity: 'high',
    category: 'correctness',
    message: 'm',
    confidence: 0.9,
    evidence: [],
    ...o,
  };
}

function digest(o: Partial<FindingDigest> = {}): FindingDigest {
  return {
    ruleId: 'lupe/correctness/x',
    path: 'a.ts',
    startLine: 1,
    endLine: 1,
    side: 'RIGHT',
    severity: 'high',
    category: 'correctness',
    title: 't',
    confidence: 0.9,
    ...o,
  };
}

describe('mergeIncrementalFindings', () => {
  test('keeps prior findings on files not reviewed this run', () => {
    const prior = [digest({ path: 'untouched.ts', ruleId: 'lupe/correctness/keep' })];
    const fresh = [finding({ path: 'a.ts', ruleId: 'lupe/correctness/new' })];
    const merged = mergeIncrementalFindings(prior, fresh, new Set(['a.ts']));
    const paths = merged.map((f) => f.path).sort();
    expect(paths).toEqual(['a.ts', 'untouched.ts']);
  });

  test('drops prior findings on a reviewed file (superseded by fresh)', () => {
    // Prior had a finding on a.ts that is no longer produced this run → it disappears.
    const prior = [digest({ path: 'a.ts', ruleId: 'lupe/correctness/stale', startLine: 5 })];
    const fresh = [finding({ path: 'a.ts', ruleId: 'lupe/correctness/new', startLine: 9 })];
    const merged = mergeIncrementalFindings(prior, fresh, new Set(['a.ts']));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.ruleId).toBe('lupe/correctness/new');
  });

  test('dedups fresh vs carried by location+rule, keeping the most confident', () => {
    const prior = [digest({ path: 'x.ts', confidence: 0.4 })];
    const fresh = [finding({ path: 'x.ts', confidence: 0.95 })];
    // x.ts not reviewed this run, but the fresh set also has it → dedup keeps 0.95.
    const merged = mergeIncrementalFindings(prior, fresh, new Set(['a.ts']));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.confidence).toBe(0.95);
  });
});
