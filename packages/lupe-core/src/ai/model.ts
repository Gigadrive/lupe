import { Context } from 'effect';
import type { Effect } from 'effect';

import type { ProviderError, RateLimitError, RefusalError, ReviewOutputError } from '../errors';
import type { Finding } from '../finding';
import type { TokenUsage } from '../review';

/**
 * Semantic task aliases. The engine asks for a *task*, never a concrete model
 * id, so provider/model swaps are a single config value (the payoff of the
 * AI SDK's `LanguageModelV2` + `createProviderRegistry` + `customProvider`).
 */
export type ReviewTask = 'triage' | 'review' | 'verify' | 'deep';

/** A read-only tool the review agent may call during generation. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool input. */
  readonly inputSchema: unknown;
}

export interface GenerateFindingsInput {
  readonly task: ReviewTask;
  /** Frozen, cacheable prefix (system prompt + standards + stable context). */
  readonly system: string;
  /** Volatile per-file / per-chunk content placed *after* the cache breakpoint. */
  readonly prompt: string;
  /** Hard cap on agent steps for this call (CI cost bound). */
  readonly maxSteps?: number;
}

export interface GenerateFindingsResult {
  readonly findings: readonly Finding[];
  readonly usage: TokenUsage;
  readonly model: string;
  readonly steps: number;
}

export interface VerifyInput {
  readonly task: ReviewTask;
  readonly system: string;
  readonly candidate: Finding;
  /** Cited code context the verifier must ground the finding against. */
  readonly evidenceContext: string;
}

export interface VerifyResult {
  readonly grounded: boolean;
  readonly reason: string;
  readonly usage: TokenUsage;
  readonly model: string;
}

export type AiError = ProviderError | RefusalError | RateLimitError | ReviewOutputError;

/**
 * The single AI seam the engine depends on. The v1 concrete Layer wraps the
 * Vercel AI SDK; adopting @effect/ai later is a localized Layer swap.
 */
export interface AiModelService {
  /** Run the (hand-rolled) review agent loop and return candidate findings. */
  readonly generateFindings: (input: GenerateFindingsInput) => Effect.Effect<GenerateFindingsResult, AiError>;

  /** Grounding verifier: drop a candidate the model cannot tie to cited code. */
  readonly verify: (input: VerifyInput) => Effect.Effect<VerifyResult, AiError>;
}

export class AiModel extends Context.Tag('@gigadrive/lupe-core/AiModel')<AiModel, AiModelService>() {}
