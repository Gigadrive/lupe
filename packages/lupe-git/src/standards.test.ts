import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { discoverCodingStandards } from './standards';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lupe-standards-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('discoverCodingStandards', () => {
  test('returns undefined when no rule files exist', () => {
    expect(discoverCodingStandards({ rootDir: root })).toBeUndefined();
  });

  test('reads rule files in precedence order with provenance headers', () => {
    write('AGENTS.md', 'agents rules');
    write('CLAUDE.md', 'claude rules');
    write('.github/copilot-instructions.md', 'copilot rules');
    const out = discoverCodingStandards({ rootDir: root })!;
    expect(out).toContain('## From CLAUDE.md');
    expect(out).toContain('## From AGENTS.md');
    expect(out).toContain('## From .github/copilot-instructions.md');
    // CLAUDE.md precedes AGENTS.md precedes copilot.
    expect(out.indexOf('CLAUDE.md')).toBeLessThan(out.indexOf('AGENTS.md'));
    expect(out.indexOf('AGENTS.md')).toBeLessThan(out.indexOf('copilot-instructions.md'));
  });

  test('explicit .lupe.yaml standards come first', () => {
    write('CLAUDE.md', 'claude rules');
    const out = discoverCodingStandards({ rootDir: root, explicit: 'explicit rules' })!;
    expect(out.indexOf('## From .lupe.yaml')).toBe(0);
    expect(out.indexOf('.lupe.yaml')).toBeLessThan(out.indexOf('CLAUDE.md'));
  });

  test('includes .cursor/rules/*.mdc in sorted order', () => {
    write('.cursor/rules/b.mdc', 'rule b');
    write('.cursor/rules/a.mdc', 'rule a');
    write('.cursor/rules/skip.txt', 'not a rule');
    const out = discoverCodingStandards({ rootDir: root })!;
    expect(out).toContain('## From .cursor/rules/a.mdc');
    expect(out).toContain('## From .cursor/rules/b.mdc');
    expect(out).not.toContain('skip.txt');
    expect(out.indexOf('a.mdc')).toBeLessThan(out.indexOf('b.mdc'));
  });

  test('dedupes identical content (e.g. CLAUDE.md → AGENTS.md symlink)', () => {
    const body = 'shared house rules';
    write('CLAUDE.md', body);
    write('AGENTS.md', body);
    const out = discoverCodingStandards({ rootDir: root })!;
    expect(out).toContain('## From CLAUDE.md');
    expect(out).not.toContain('## From AGENTS.md'); // identical content skipped
    expect(out.match(/shared house rules/g)).toHaveLength(1);
  });

  test('is byte-stable and respects the byte cap', () => {
    write('CLAUDE.md', 'x'.repeat(500));
    write('AGENTS.md', 'y'.repeat(500));
    const out1 = discoverCodingStandards({ rootDir: root, maxBytes: 200 })!;
    const out2 = discoverCodingStandards({ rootDir: root, maxBytes: 200 })!;
    expect(out1).toBe(out2); // deterministic → cache-safe
    expect(out1).toContain('truncated at 200 chars');
  });

  test('ignores empty/whitespace-only files', () => {
    write('CLAUDE.md', '   \n  ');
    expect(discoverCodingStandards({ rootDir: root })).toBeUndefined();
  });
});
