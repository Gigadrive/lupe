import { describe, expect, test } from 'vitest';

import { normalizeConfig } from './config';

describe('normalizeConfig', () => {
  test('empty config yields all-undefined', () => {
    const c = normalizeConfig({});
    expect(c.profile).toBeUndefined();
    expect(c.confidenceThreshold).toBeUndefined();
    expect(c.categoryThresholds).toBeUndefined();
    expect(c.pathThresholds).toBeUndefined();
  });

  test('accepts snake_case and camelCase equivalently', () => {
    const snake = normalizeConfig({
      base_url: 'https://x',
      path_filters: ['!**/dist/**'],
      max_findings: 8,
      confidence_threshold: 0.6,
      suppress_advisory: true,
      coding_standards: 'be nice',
      max_chunk_tokens: 100,
      review_concurrency: 2,
      min_severity_to_comment: 'high',
    });
    const camel = normalizeConfig({
      baseURL: 'https://x',
      pathFilters: ['!**/dist/**'],
      maxFindings: 8,
      confidenceThreshold: 0.6,
      suppressAdvisory: true,
      codingStandards: 'be nice',
      maxChunkTokens: 100,
      reviewConcurrency: 2,
      minSeverityToComment: 'high',
    });
    expect(camel).toEqual(snake);
    expect(snake.confidenceThreshold).toBe(0.6);
    expect(snake.suppressAdvisory).toBe(true);
    expect(snake.minSeverityToComment).toBe('high');
  });

  test('parses category thresholds (snake + camel nested keys)', () => {
    const c = normalizeConfig({
      category_thresholds: {
        security: { min_confidence: 0.7, min_severity: 'high' },
        style: { minConfidence: 0.6 },
        bogus: { min_confidence: 0.9 }, // unknown category ignored
      },
    });
    expect(c.categoryThresholds).toEqual({
      security: { minConfidence: 0.7, minSeverity: 'high' },
      style: { minConfidence: 0.6, minSeverity: undefined },
    });
  });

  test('parses path thresholds and drops entries without a glob', () => {
    const c = normalizeConfig({
      path_thresholds: [
        { glob: 'src/**', min_severity: 'medium' },
        { min_confidence: 0.9 }, // no glob → dropped
      ],
    });
    expect(c.pathThresholds).toEqual([{ glob: 'src/**', minConfidence: undefined, minSeverity: 'medium' }]);
  });

  test('rejects an invalid severity value', () => {
    expect(normalizeConfig({ min_severity_to_comment: 'sev0' }).minSeverityToComment).toBeUndefined();
  });

  test('only chill/assertive are valid profiles', () => {
    expect(normalizeConfig({ profile: 'assertive' }).profile).toBe('assertive');
    expect(normalizeConfig({ profile: 'nope' }).profile).toBeUndefined();
  });
});
