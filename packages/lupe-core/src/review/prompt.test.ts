import { describe, expect, test } from 'vitest';

import { buildSystemPrompt } from './prompt';

describe('buildSystemPrompt — coding standards in the cached prefix', () => {
  test('embeds coding standards under a stable heading', () => {
    const out = buildSystemPrompt({ codingStandards: 'Always use tabs.' });
    expect(out).toContain('## Project coding standards');
    expect(out).toContain('Always use tabs.');
  });

  test('is byte-identical for identical options (Anthropic prompt-cache prefix must not drift)', () => {
    const opts = { profile: 'chill' as const, codingStandards: '## From AGENTS.md\nbe precise' };
    expect(buildSystemPrompt(opts)).toBe(buildSystemPrompt(opts));
  });

  test('omits the section entirely when there are no standards (no empty heading)', () => {
    expect(buildSystemPrompt({})).not.toContain('## Project coding standards');
  });

  test('instructs reachability-aware impact calibration and bans no-op suggestions', () => {
    const out = buildSystemPrompt({});
    expect(out).toMatch(/reachable/i);
    expect(out).toMatch(/no-op/i);
  });
});
