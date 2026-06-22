import { Effect } from 'effect';

import {
  AiModel,
  type AiError,
  type GenerateDescriptionResult,
  type GenerateFindingsResult,
  type ReviewTask,
} from '../ai/model';
import type { DiffFile } from '../diff';
import type { Description } from '../finding';
import type { ReviewTarget } from '../review';
import {
  buildDescriptionPrompt,
  buildDescriptionSystemPrompt,
  buildReviewPrompt,
  buildSystemPrompt,
  type PromptOptions,
} from './prompt';

export interface GenerateCandidatesOptions extends PromptOptions {
  /** Which model task to route the review through (default "review"). */
  readonly task?: ReviewTask;
  readonly maxSteps?: number;
  /**
   * Prebuilt frozen system prefix. When omitted it is built from the prompt
   * options. The pipeline passes a single prebuilt prefix across all chunks so
   * it stays byte-identical (the Anthropic prompt cache is prefix-keyed).
   */
  readonly system?: string;
}

/**
 * Stage 4 (generation): build the cacheable system prefix + volatile diff
 * prompt and run the agent loop via the injected AiModel to produce candidate
 * findings (biased for recall — filtering happens downstream).
 */
export function generateCandidates(
  files: readonly DiffFile[],
  target: ReviewTarget | undefined,
  options: GenerateCandidatesOptions = {}
): Effect.Effect<GenerateFindingsResult, AiError, AiModel> {
  return Effect.gen(function* () {
    const ai = yield* AiModel;
    const system = options.system ?? buildSystemPrompt(options);
    const prompt = buildReviewPrompt(files, target);
    return yield* ai.generateFindings({
      task: options.task ?? 'review',
      system,
      prompt,
      maxSteps: options.maxSteps,
    });
  });
}

/**
 * Stage 4 (description): build the cacheable system prefix + volatile diff
 * prompt and run the agent loop via the injected AiModel to produce a PR
 * description. Uses a single-shot JSON output; no tool calls needed.
 */
export function generateDescription(
  files: readonly DiffFile[],
  target: ReviewTarget | undefined,
  options: PromptOptions = {}
): Effect.Effect<GenerateDescriptionResult, AiError, AiModel> {
  return Effect.gen(function* () {
    const ai = yield* AiModel;
    const system = buildDescriptionSystemPrompt(options);
    const prompt = buildDescriptionPrompt(files, target);
    return yield* ai.generateDescription({ task: 'describe', system, prompt });
  });
}

export type { Description };
