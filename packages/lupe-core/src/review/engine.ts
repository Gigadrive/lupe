import { Effect } from "effect";
import type { DiffFile } from "../diff";
import type { ReviewTarget } from "../review";
import { AiModel, type AiError, type GenerateFindingsResult, type ReviewTask } from "../ai/model";
import { buildReviewPrompt, buildSystemPrompt, type PromptOptions } from "./prompt";

export interface GenerateCandidatesOptions extends PromptOptions {
  /** Which model task to route the review through (default "review"). */
  readonly task?: ReviewTask;
  readonly maxSteps?: number;
}

/**
 * Stage 4 (generation): build the cacheable system prefix + volatile diff
 * prompt and run the agent loop via the injected AiModel to produce candidate
 * findings (biased for recall — filtering happens downstream).
 */
export function generateCandidates(
  files: readonly DiffFile[],
  target: ReviewTarget | undefined,
  options: GenerateCandidatesOptions = {},
): Effect.Effect<GenerateFindingsResult, AiError, AiModel> {
  return Effect.gen(function* () {
    const ai = yield* AiModel;
    const system = buildSystemPrompt(options);
    const prompt = buildReviewPrompt(files, target);
    return yield* ai.generateFindings({
      task: options.task ?? "review",
      system,
      prompt,
      maxSteps: options.maxSteps,
    });
  });
}
