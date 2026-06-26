import { generateText, Output, stepCountIs } from 'ai';
import { Effect, Layer } from 'effect';
import { z } from 'zod';

import { ProviderError, RateLimitError, RefusalError, ReviewOutputError } from '../errors';
import { Finding } from '../finding';
import { RepoSource } from '../ports';
import {
  AiModel,
  type AiError,
  type AiModelService,
  type GenerateFindingsInput,
  type GenerateFindingsResult,
  type VerifyInput,
  type VerifyResult,
} from './model';
import { createModelResolver, type LupeAiConfig } from './provider';
import { buildRepoTools } from './tools';
import { anthropicCacheBreakpoint, toTokenUsage } from './usage';

const DEFAULT_MAX_STEPS = 12;

/** Map an AI SDK / network failure onto a tagged lupe error. */
function liftError(error: unknown, provider: string): AiError {
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (/NoObjectGenerated|NoOutputGenerated/.test(name)) {
    return new ReviewOutputError({
      message: 'model did not produce valid structured findings',
      cause: error,
    });
  }
  const status =
    (error as { statusCode?: number; status?: number } | null)?.statusCode ??
    (error as { status?: number } | null)?.status;
  if (status === 429 || /rate.?limit/i.test(message)) {
    return new RateLimitError({ message, provider });
  }
  if (/refus/i.test(name) || /\brefus(e|al|ed)\b/i.test(message)) {
    return new RefusalError({ message });
  }
  return new ProviderError({ message, provider, cause: error });
}

const VerifySchema = z.object({
  grounded: z.boolean(),
  reason: z.string(),
  suggestionValid: z.boolean().optional(),
  impactConfirmed: z.boolean().optional(),
});

/**
 * The v1 concrete AiModel Layer — wraps the Vercel AI SDK. The engine depends
 * only on the AiModel tag, so adopting @effect/ai later is a Layer swap.
 *
 * Requires RepoSource (for the agent's read-only tools).
 */
export function AiSdkLive(config: LupeAiConfig): Layer.Layer<AiModel, never, RepoSource> {
  return Layer.effect(
    AiModel,
    Effect.gen(function* () {
      const repo = yield* RepoSource;
      const tools = buildRepoTools(repo);
      const resolveModel = createModelResolver(config);
      const cacheable = config.provider === 'anthropic';

      const systemMessage = (content: string) =>
        cacheable
          ? { role: 'system' as const, content, providerOptions: anthropicCacheBreakpoint() }
          : { role: 'system' as const, content };

      const generateFindings = (input: GenerateFindingsInput): Effect.Effect<GenerateFindingsResult, AiError> =>
        Effect.tryPromise({
          try: async () => {
            const { model, modelId } = resolveModel(input.task);
            const result = await generateText({
              model,
              messages: [systemMessage(input.system), { role: 'user', content: input.prompt }],
              tools,
              stopWhen: [stepCountIs(input.maxSteps ?? DEFAULT_MAX_STEPS)],
              output: Output.array({ element: Finding }),
              // The system message is our own trusted content; placed in messages so the
              // Anthropic cache breakpoint can attach to it.
              allowSystemInMessages: true,
              maxRetries: 2,
            });
            const findings = (result.output ?? []) as readonly Finding[];
            return {
              findings,
              usage: toTokenUsage(result.totalUsage),
              model: modelId,
              steps: result.steps.length,
            };
          },
          catch: (error) => liftError(error, config.provider),
        });

      const verify = (input: VerifyInput): Effect.Effect<VerifyResult, AiError> =>
        Effect.tryPromise({
          try: async () => {
            const { model, modelId } = resolveModel(input.task);
            const candidate = input.candidate;
            const result = await generateText({
              model,
              messages: [
                systemMessage(input.system),
                {
                  role: 'user',
                  content:
                    `Finding under review:\n` +
                    `- rule: ${candidate.ruleId}\n` +
                    `- title: ${candidate.title}\n` +
                    `- location: ${candidate.path}:${candidate.startLine}\n` +
                    `- claim: ${candidate.message}\n` +
                    (candidate.suggestion !== undefined
                      ? `- proposed suggestion (replacement for the anchored range):\n${candidate.suggestion}\n`
                      : '') +
                    `\nCited code context:\n${input.evidenceContext}\n\n` +
                    `Decide whether this finding is correct AND grounded in the cited code. ` +
                    `Set grounded=false if it is speculative, already handled, or not supported by the code. ` +
                    `Set impactConfirmed=false if the mechanism is real but the claimed impact/severity depends on a precondition not visible here (an off-context caller, an external contract, or unproven attacker-/tenant-controllability).` +
                    (candidate.suggestion !== undefined
                      ? ` Also set suggestionValid=false if the proposed suggestion would not correctly fix the problem (e.g. a no-op or code that does not compile).`
                      : ''),
                },
              ],
              output: Output.object({ schema: VerifySchema }),
              allowSystemInMessages: true,
              maxRetries: 2,
            });
            const out = result.output;
            return {
              grounded: out.grounded,
              reason: out.reason,
              suggestionValid: out.suggestionValid,
              impactConfirmed: out.impactConfirmed,
              usage: toTokenUsage(result.totalUsage),
              model: modelId,
            };
          },
          catch: (error) => liftError(error, config.provider),
        });

      const service: AiModelService = { generateFindings, verify };
      return service;
    })
  );
}
