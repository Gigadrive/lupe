import { describe, expect, test } from 'vitest';

import type { Finding } from '../finding';
import { applyFilters, dedupeFindings } from './filter';

function finding(o: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'lupe/correctness/x',
    title: 't',
    path: 'a.ts',
    startLine: 1,
    endLine: 1,
    side: 'RIGHT',
    severity: 'medium',
    category: 'correctness',
    message: 'm',
    confidence: 0.9,
    evidence: [],
    ...o,
  };
}

describe('dedupeFindings', () => {
  test('collapses same location+rule, keeping highest confidence', () => {
    const out = dedupeFindings([finding({ confidence: 0.6 }), finding({ confidence: 0.95 })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.confidence).toBe(0.95);
  });
});

describe('applyFilters', () => {
  test('drops findings below the confidence threshold', () => {
    const r = applyFilters([finding({ confidence: 0.4, startLine: 1 }), finding({ confidence: 0.8, startLine: 2 })], {
      confidenceThreshold: 0.5,
    });
    expect(r.kept).toHaveLength(1);
    expect(r.kept[0]!.confidence).toBe(0.8);
    expect(r.dropped).toHaveLength(1);
  });

  test('suppresses advisory categories when asked', () => {
    const r = applyFilters(
      [finding({ category: 'style', startLine: 1 }), finding({ category: 'security', startLine: 2 })],
      {
        suppressAdvisory: true,
      }
    );
    expect(r.kept.map((f) => f.category)).toEqual(['security']);
  });

  test('applies learned suppressions by substring', () => {
    const r = applyFilters([finding({ title: 'Prefer const over let', startLine: 1 })], {
      learnings: ['prefer const'],
    });
    expect(r.kept).toHaveLength(0);
  });

  test('caps to maxFindings, keeping the most severe', () => {
    const r = applyFilters(
      [
        finding({ severity: 'low', startLine: 1 }),
        finding({ severity: 'critical', startLine: 2 }),
        finding({ severity: 'medium', startLine: 3 }),
      ],
      { maxFindings: 2 }
    );
    expect(r.kept).toHaveLength(2);
    expect(r.kept[0]!.severity).toBe('critical');
    expect(r.kept.map((f) => f.severity)).not.toContain('low');
  });

  test('no threshold config keeps the global-confidence-only behaviour (default 0.5)', () => {
    const findings = [finding({ confidence: 0.4, startLine: 1 }), finding({ confidence: 0.9, startLine: 2 })];
    expect(applyFilters(findings).kept.map((f) => f.confidence)).toEqual([0.9]);
  });

  test('per-category confidence threshold overrides the global floor', () => {
    const r = applyFilters(
      [
        finding({ category: 'security', confidence: 0.6, startLine: 1 }),
        finding({ category: 'correctness', confidence: 0.6, startLine: 2 }),
      ],
      { confidenceThreshold: 0.5, categoryThresholds: { security: { minConfidence: 0.7 } } }
    );
    // security needs 0.7 (0.6 dropped); correctness uses global 0.5 (0.6 kept).
    expect(r.kept.map((f) => f.category)).toEqual(['correctness']);
  });

  test('per-category minSeverity drops less-severe findings in that category', () => {
    const r = applyFilters(
      [
        finding({ category: 'style', severity: 'low', startLine: 1 }),
        finding({ category: 'style', severity: 'high', startLine: 2 }),
      ],
      { categoryThresholds: { style: { minSeverity: 'high' } } }
    );
    expect(r.kept.map((f) => f.severity)).toEqual(['high']);
  });

  test('per-path threshold takes precedence over category and global', () => {
    const r = applyFilters(
      [
        finding({ path: 'src/app.ts', confidence: 0.6, startLine: 1 }),
        finding({ path: 'test/app.test.ts', confidence: 0.6, startLine: 2 }),
      ],
      {
        confidenceThreshold: 0.5,
        pathThresholds: [{ glob: 'test/**', minConfidence: 0.9 }],
      }
    );
    // test/** needs 0.9 (0.6 dropped); src/app.ts uses global 0.5 (0.6 kept).
    expect(r.kept.map((f) => f.path)).toEqual(['src/app.ts']);
  });
});
