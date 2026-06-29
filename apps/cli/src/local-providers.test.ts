import { describe, expect, test } from 'vitest';

import type { Finding } from '@gigadrive/lupe-core';

import {
  coerceFindings,
  coerceVerify,
  dedupeLocalFindings,
  extractFirstJson,
  isLocalProvider,
} from './local-providers';

describe('extractFirstJson', () => {
  test('pulls a balanced array out of surrounding prose', () => {
    expect(extractFirstJson('here you go: [1, 2, [3]] done', '[')).toBe('[1, 2, [3]]');
  });

  test('ignores brackets inside strings', () => {
    expect(extractFirstJson('[{"a":"]not]"}]', '[')).toBe('[{"a":"]not]"}]');
  });

  test('returns undefined when absent', () => {
    expect(extractFirstJson('no json here', '{')).toBeUndefined();
  });
});

describe('coerceFindings', () => {
  test('validates and keeps well-formed findings, drops junk', () => {
    const text = `Sure, here:
    [
      {"ruleId":"lupe/security/x","title":"t","path":"a.ts","startLine":1,"endLine":1,"severity":"high","category":"security","message":"m","confidence":0.9},
      {"not":"a finding"}
    ]`;
    const out = coerceFindings(text);
    expect(out).toHaveLength(1);
    expect(out[0]!.ruleId).toBe('lupe/security/x');
    expect(out[0]!.side).toBe('RIGHT'); // schema default applied
  });

  test('returns [] when no array is present', () => {
    expect(coerceFindings('the model refused')).toEqual([]);
  });
});

describe('coerceVerify', () => {
  test('parses grounded/reason', () => {
    expect(coerceVerify('verdict: {"grounded": false, "reason": "speculative"}')).toEqual({
      grounded: false,
      reason: 'speculative',
    });
  });

  test('defaults to kept when unparsable', () => {
    expect(coerceVerify('no json').grounded).toBe(true);
  });

  test('parses suggestionValid when present', () => {
    expect(coerceVerify('{"grounded": true, "reason": "ok", "suggestionValid": false}')).toEqual({
      grounded: true,
      reason: 'ok',
      suggestionValid: false,
    });
  });

  test('leaves suggestionValid undefined when absent or non-boolean', () => {
    expect(coerceVerify('{"grounded": true, "reason": "ok"}').suggestionValid).toBeUndefined();
    expect(
      coerceVerify('{"grounded": true, "reason": "ok", "suggestionValid": "yes"}').suggestionValid
    ).toBeUndefined();
  });

  test('parses impactConfirmed when present, undefined otherwise', () => {
    expect(coerceVerify('{"grounded": true, "reason": "r", "impactConfirmed": false}').impactConfirmed).toBe(false);
    expect(coerceVerify('{"grounded": true, "reason": "r"}').impactConfirmed).toBeUndefined();
  });
});

describe('dedupeLocalFindings', () => {
  const f = (o: Partial<Finding>): Finding => ({
    ruleId: 'lupe/correctness/x',
    title: 't',
    path: 'a.ts',
    startLine: 1,
    endLine: 1,
    side: 'RIGHT',
    severity: 'medium',
    category: 'correctness',
    message: 'm',
    confidence: 0.5,
    evidence: [],
    ...o,
  });

  test('collapses same-anchor findings from multiple passes, keeping the most confident', () => {
    const out = dedupeLocalFindings([
      f({ startLine: 10, confidence: 0.4, title: 'pass1' }),
      f({ startLine: 10, confidence: 0.8, title: 'pass2' }),
      f({ startLine: 20, confidence: 0.6, title: 'other' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((x) => x.startLine === 10)!.title).toBe('pass2');
    expect(out.find((x) => x.startLine === 10)!.confidence).toBe(0.8);
  });

  test('keeps findings at distinct anchors', () => {
    expect(
      dedupeLocalFindings([f({ startLine: 1 }), f({ startLine: 2 }), f({ path: 'b.ts', startLine: 1 })])
    ).toHaveLength(3);
  });
});

describe('isLocalProvider', () => {
  test('recognises the local backends', () => {
    expect(isLocalProvider('claude-cli')).toBe(true);
    expect(isLocalProvider('codex-cli')).toBe(true);
    expect(isLocalProvider('anthropic')).toBe(false);
  });
});
