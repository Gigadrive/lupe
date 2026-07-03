import { describe, expect, test } from 'vitest';

import type { DiffFile } from '@gigadrive/lupe-core';

import { redactLine, redactSecrets } from './redact';

describe('redactLine', () => {
  test('redacts an AWS access key id', () => {
    expect(redactLine('const k = "AKIAIOSFODNN7EXAMPLE";')).toContain('«redacted:aws-access-key»');
  });

  test('redacts a GitHub token', () => {
    expect(redactLine('token: ghp_0123456789abcdefghijklmnopqrstuvwxyz')).toContain('«redacted:github-token»');
  });

  test('redacts a JWT', () => {
    const jwt = 'eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM';
    expect(redactLine(`auth=${jwt}`)).toContain('«redacted:jwt»');
  });

  test('redacts a PEM private key marker', () => {
    expect(redactLine('-----BEGIN RSA PRIVATE KEY-----')).toBe('«redacted:private-key»');
  });

  test('redacts a long, digit-bearing secret assignment value but keeps the key', () => {
    const out = redactLine('password = "s3cr3tP4ssw0rdValue"');
    expect(out).toContain('password');
    expect(out).toContain('«redacted:secret»');
    expect(out).not.toContain('s3cr3tP4ssw0rdValue');
  });

  test('does NOT redact ordinary code that looks like an assignment', () => {
    expect(redactLine('token = getToken()')).toBe('token = getToken()');
    expect(redactLine('const password = userInput')).toBe('const password = userInput');
  });

  test('leaves non-secret content untouched', () => {
    expect(redactLine('const total = a + b;')).toBe('const total = a + b;');
  });
});

function fileWith(content: string): DiffFile {
  return {
    path: 'a.ts',
    status: 'modified',
    binary: false,
    additions: 1,
    deletions: 0,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ kind: 'add', content, newLine: 1 }] }],
  };
}

describe('redactSecrets', () => {
  test('rewrites files and counts redacted lines', () => {
    const { files, redactions } = redactSecrets([fileWith('key=AKIAIOSFODNN7EXAMPLE'), fileWith('const x = 1;')]);
    expect(redactions).toBe(1);
    expect(files[0]!.hunks[0]!.lines[0]!.content).toContain('«redacted:aws-access-key»');
    expect(files[1]!.hunks[0]!.lines[0]!.content).toBe('const x = 1;');
  });

  test('returns the same file object when nothing is redacted', () => {
    const input = [fileWith('const x = 1;')];
    const { files, redactions } = redactSecrets(input);
    expect(redactions).toBe(0);
    expect(files[0]).toBe(input[0]); // unchanged reference
  });
});
