import { describe, expect, test } from 'vitest';

import type { Finding } from '../finding';
import {
  buildReviewState,
  encodeState,
  parseInlinePath,
  parseState,
  renderInlineComment,
  renderSummaryMarkdown,
  suggestionBlock,
  SUMMARY_MARKER,
} from './markdown';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'lupe/security/sql-injection',
    title: 'Unparameterised SQL',
    path: 'src/db.ts',
    startLine: 10,
    endLine: 10,
    side: 'RIGHT',
    severity: 'high',
    category: 'security',
    message: 'Use a parameterised query.',
    confidence: 0.92,
    evidence: [],
    ...overrides,
  };
}

describe('markdown rendering', () => {
  test('suggestionBlock emits a GitHub suggestion fence', () => {
    expect(suggestionBlock('const x = 1;\n')).toBe('```suggestion\nconst x = 1;\n```');
  });

  test('inline comment includes title, message, suggestion, confidence', () => {
    const body = renderInlineComment(finding({ suggestion: 'db.query(sql, [id])' }));
    expect(body).toContain('Unparameterised SQL');
    expect(body).toContain('Use a parameterised query.');
    expect(body).toContain('```suggestion');
    expect(body).toContain('confidence 92%');
  });

  test('summary embeds the marker, counts, and recoverable state', () => {
    const md = renderSummaryMarkdown([finding(), finding({ severity: 'low', category: 'style' })], {
      headSha: 'abc123',
    });
    expect(md.startsWith(SUMMARY_MARKER)).toBe(true);
    expect(md).toContain('**2** findings');
    expect(md).toContain('1 actionable, 1 advisory');
    const state = parseState(md);
    expect(state?.lastReviewedSha).toBe('abc123');
  });

  test('empty summary reports no issues', () => {
    const md = renderSummaryMarkdown([]);
    expect(md).toContain('No issues found');
  });

  test('state round-trips through encode/parse', () => {
    const encoded = encodeState({ version: 1, lastReviewedSha: 'deadbeef', findingCount: 3 });
    expect(parseState(`some text ${encoded} more`)).toEqual({
      version: 1,
      lastReviewedSha: 'deadbeef',
      findingCount: 3,
    });
  });

  test('inline comment embeds a parseable path marker', () => {
    const body = renderInlineComment(finding({ path: 'src/db.ts' }));
    expect(parseInlinePath(body)).toBe('src/db.ts');
    expect(parseInlinePath('no marker here')).toBeUndefined();
  });

  test('buildReviewState carries finding digests + posted keys and round-trips', () => {
    const state = buildReviewState({ headSha: 'abc', findings: [finding()], postedKeys: ['k1', 'k2'] });
    const md = renderSummaryMarkdown([finding()], { state });
    const parsed = parseState(md);
    expect(parsed?.findings).toHaveLength(1);
    expect(parsed?.findings?.[0]!.path).toBe('src/db.ts');
    expect(parsed?.postedKeys).toEqual(['k1', 'k2']);
  });

  test('buildReviewState caps digests at 80 (keeps most severe)', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      finding({ severity: i === 0 ? 'critical' : 'low', startLine: i + 1, ruleId: `lupe/x/r${i}` })
    );
    const state = buildReviewState({ headSha: 'abc', findings: many });
    expect(state.findings).toHaveLength(80);
    expect(state.findings?.[0]!.severity).toBe('critical');
  });
});
