import { describe, expect, test } from 'vitest';

import type { TokenUsage } from '../review';
import { computeCost, priceFor } from './pricing';

function usage(o: Partial<TokenUsage> = {}): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, ...o };
}

describe('pricing', () => {
  test('matches model families by substring', () => {
    expect(priceFor('claude-opus-4-8').input).toBe(15);
    expect(priceFor('claude-haiku-4-5').input).toBe(0.8);
    expect(priceFor('anthropic/claude-sonnet-4-6').output).toBe(15);
  });

  test('computeCost charges fresh input + output', () => {
    const cost = computeCost('claude-opus-4-8', usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(15 + 75);
  });

  test('cache reads are billed at the cheaper rate and excluded from fresh input', () => {
    const withCache = computeCost('claude-opus-4-8', usage({ inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }));
    // all input was a cache read → 1M * $1.50/M
    expect(withCache).toBeCloseTo(1.5);
  });

  test('unknown models cost zero (until the table is bumped)', () => {
    expect(computeCost('some-unknown-model', usage({ inputTokens: 1000 }))).toBe(0);
  });
});
