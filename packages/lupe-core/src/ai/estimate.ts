import type { DiffFile } from '../diff';
import { renderDiffPrompt } from '../render/diff-prompt';
import { estimateTokens } from '../review/chunk';
import { resolvePrice, type ModelPriceOverrides } from './pricing';

/**
 * Pre-flight cost estimation for a chunked review run. The estimate is used only
 * to enforce a hard `maxCostUsd` cap before/mid the model calls — it is
 * deliberately biased to over-predict so the cap fails safe.
 */

/** Multiplier for the agent step loop re-sending growing context across steps. Biased high. */
export const LOOP_FACTOR = 3;
/** Output-token allowance per chunk (findings + tool-call arguments). Biased high. */
export const OUTPUT_ALLOWANCE_TOKENS = 2500;

export interface EstimateInput {
  /** The frozen, cacheable system prefix (shared byte-identically across chunks). */
  readonly system: string;
  readonly chunks: readonly (readonly DiffFile[])[];
  readonly modelId: string;
  readonly overrides?: ModelPriceOverrides;
}

export interface CostEstimate {
  readonly estimatedUsd: number;
  /** False when the model has no known price — a cost cap must fail closed. */
  readonly known: boolean;
}

/**
 * Cache-aware pre-flight estimate. Chunk 0 writes the shared system prefix to the
 * Anthropic cache; chunks 1..N read it. Diff input is scaled by LOOP_FACTOR for the
 * agent step loop, plus a flat output allowance per chunk.
 */
export function estimateGenerationCostUsd(input: EstimateInput): CostEstimate {
  const { price, known } = resolvePrice(input.modelId, input.overrides);
  const systemTokens = estimateTokens(input.system);
  let usd = 0;
  input.chunks.forEach((chunk, i) => {
    const diffTokens = estimateTokens(renderDiffPrompt(chunk));
    const systemCost = i === 0 ? systemTokens * price.cacheWrite : systemTokens * price.cacheRead;
    const inputCost = diffTokens * LOOP_FACTOR * price.input;
    const outputCost = OUTPUT_ALLOWANCE_TOKENS * price.output;
    usd += (systemCost + inputCost + outputCost) / 1_000_000;
  });
  return { estimatedUsd: usd, known };
}
