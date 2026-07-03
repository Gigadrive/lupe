import { describe, expect, test } from 'vitest';

import type { TokenUsage } from '../review';
import { computeCost, priceFor, resolvePrice } from './pricing';

function usage(o: Partial<TokenUsage> = {}): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, ...o };
}

describe('pricing', () => {
  test('matches model families by substring', () => {
    expect(priceFor('claude-opus-4-8').input).toBe(5);
    expect(priceFor('claude-haiku-4-5').input).toBe(1);
    expect(priceFor('anthropic/claude-sonnet-4-6').output).toBe(15);
    expect(priceFor('claude-fable-5').output).toBe(50);
  });

  test('computeCost charges fresh input + output', () => {
    const cost = computeCost('claude-opus-4-8', usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(cost).toBeCloseTo(5 + 25);
  });

  test('cache reads are billed at the cheaper rate and excluded from fresh input', () => {
    const withCache = computeCost('claude-opus-4-8', usage({ inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }));
    // all input was a cache read → 1M * $0.50/M
    expect(withCache).toBeCloseTo(0.5);
  });

  test('unknown models resolve to known:false and cost zero', () => {
    expect(resolvePrice('some-unknown-model').known).toBe(false);
    expect(resolvePrice('claude-opus-4-8').known).toBe(true);
    expect(computeCost('some-unknown-model', usage({ inputTokens: 1000 }))).toBe(0);
  });

  test('per-deployment overrides win over the vendored table', () => {
    const overrides = { 'my-model': { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 } };
    const resolved = resolvePrice('my-model', overrides);
    expect(resolved.known).toBe(true);
    expect(resolved.price.input).toBe(2);
    const cost = computeCost('my-model', usage({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), overrides);
    expect(cost).toBeCloseTo(2 + 8);
  });
});
