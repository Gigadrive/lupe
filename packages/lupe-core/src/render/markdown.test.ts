import { describe, expect, test } from 'vitest';

import type { Finding } from '../finding';
import {
  encodeState,
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
});
