import type { ModelCost, TokenUsage } from '../review';

/**
 * Vendored pricing table (USD per 1M tokens). Anthropic rows verified against
 * published pricing (Opus 4.x $5/$25, Sonnet $3/$15, Haiku 4.5 $1/$5, Fable 5
 * $10/$50); cache rows assume the 5-minute ephemeral cache lupe uses
 * (`cacheRead = 0.1 × input`, `cacheWrite = 1.25 × input`). Non-Anthropic rows
 * are rough placeholders — supply exact numbers per deployment via
 * `LupeConfig.modelPrices` (threaded here as `overrides`). Matched by substring
 * so model id variants resolve to a family.
 */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** Per-deployment price overrides, keyed by (substring-free) exact model id. */
export type ModelPriceOverrides = Readonly<Record<string, ModelPrice>>;

/** A resolved price plus whether it came from a real rule/override. `known` is
 * false only when nothing matched — callers that gate spend on cost (the
 * pre-flight estimate / cost cap) must fail closed in that case. */
export interface ResolvedPrice {
  readonly price: ModelPrice;
  readonly known: boolean;
}

interface PriceRule {
  readonly match: RegExp;
  readonly price: ModelPrice;
}

const PRICES: readonly PriceRule[] = [
  // Anthropic Claude family (5-minute ephemeral cache rates).
  { match: /opus/i, price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
  { match: /sonnet/i, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  { match: /haiku/i, price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  { match: /fable|mythos/i, price: { input: 10, output: 50, cacheRead: 1.0, cacheWrite: 12.5 } },
  // OpenAI / Google rough placeholders — override per-deployment via `modelPrices`.
  {
    match: /gpt-5-mini|gpt-4o-mini/i,
    price: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  },
  { match: /gpt-5|gpt-4\.1|gpt-4o/i, price: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 } },
  { match: /gemini.*flash/i, price: { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0.15 } },
  { match: /gemini.*pro/i, price: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 1.25 } },
];

const UNKNOWN_PRICE: ModelPrice = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Resolve a model id to a price. A per-deployment `overrides` entry wins over
 * the vendored table; an unmatched id resolves to a zero price with
 * `known: false` so cost-gating callers can distinguish "free" from "unpriced".
 */
export function resolvePrice(modelId: string, overrides?: ModelPriceOverrides): ResolvedPrice {
  const override = overrides?.[modelId];
  if (override) return { price: override, known: true };
  for (const rule of PRICES) if (rule.match.test(modelId)) return { price: rule.price, known: true };
  return { price: UNKNOWN_PRICE, known: false };
}

export function priceFor(modelId: string, overrides?: ModelPriceOverrides): ModelPrice {
  return resolvePrice(modelId, overrides).price;
}

/** Compute USD cost for a single model's usage. Unknown models cost 0. */
export function computeCost(modelId: string, usage: TokenUsage, overrides?: ModelPriceOverrides): number {
  const price = resolvePrice(modelId, overrides).price;
  const freshInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheCreationTokens);
  const cost =
    (freshInput * price.input +
      usage.cacheReadTokens * price.cacheRead +
      usage.cacheCreationTokens * price.cacheWrite +
      usage.outputTokens * price.output) /
    1_000_000;
  return cost;
}

export function modelCost(modelId: string, usage: TokenUsage, overrides?: ModelPriceOverrides): ModelCost {
  return { model: modelId, usage, costUsd: computeCost(modelId, usage, overrides) };
}
