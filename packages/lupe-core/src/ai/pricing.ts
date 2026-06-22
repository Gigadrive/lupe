import type { ModelCost, TokenUsage } from '../review';

/**
 * Vendored pricing table (USD per 1M tokens). APPROXIMATE — verify against
 * current provider pricing and bump as needed. Matched by substring so model
 * id variants resolve to a family.
 */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

interface PriceRule {
  readonly match: RegExp;
  readonly price: ModelPrice;
}

const PRICES: readonly PriceRule[] = [
  // Anthropic Claude family
  { match: /opus/i, price: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { match: /sonnet/i, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: /haiku/i, price: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1.0 } },
  // Fable 5 — placeholder; update when pricing is published.
  { match: /fable/i, price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
  // OpenAI / Google rough placeholders (override per-deployment as needed).
  {
    match: /gpt-5-mini|gpt-4o-mini/i,
    price: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  },
  { match: /gpt-5|gpt-4\.1|gpt-4o/i, price: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 } },
  { match: /gemini.*flash/i, price: { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0.15 } },
  { match: /gemini.*pro/i, price: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 } },
];

const UNKNOWN_PRICE: ModelPrice = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export function priceFor(modelId: string): ModelPrice {
  for (const rule of PRICES) if (rule.match.test(modelId)) return rule.price;
  return UNKNOWN_PRICE;
}

/** Compute USD cost for a single model's usage. */
export function computeCost(modelId: string, usage: TokenUsage): number {
  const price = priceFor(modelId);
  const freshInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheCreationTokens);
  const cost =
    (freshInput * price.input +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheCreationTokens * price.cacheWrite +
      usage.outputTokens * price.output) /
    1_000_000;
  return cost;
}

export function modelCost(modelId: string, usage: TokenUsage): ModelCost {
  return { model: modelId, usage, costUsd: computeCost(modelId, usage) };
}
