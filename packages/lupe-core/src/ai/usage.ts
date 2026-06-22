import type { LanguageModelUsage } from 'ai';

import type { TokenUsage } from '../review';

/** Map the AI SDK's unified usage onto lupe's TokenUsage (cache-aware). */
export function toTokenUsage(usage: LanguageModelUsage | undefined): TokenUsage {
  const details = usage?.inputTokenDetails;
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: details?.cacheReadTokens ?? usage?.cachedInputTokens ?? 0,
    cacheCreationTokens: details?.cacheWriteTokens ?? 0,
  };
}

/** Provider options that mark an Anthropic prompt-cache breakpoint on a message. */
export function anthropicCacheBreakpoint(): { anthropic: { cacheControl: { type: 'ephemeral' } } } {
  return { anthropic: { cacheControl: { type: 'ephemeral' } } };
}
