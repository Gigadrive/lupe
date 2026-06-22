import { Effect } from 'effect';

import { AiModel, type AiError } from '../ai/model';
import { modelCost } from '../ai/pricing';
import type { DiffFile } from '../diff';
import type { Finding } from '../finding';
import { renderSummaryMarkdown } from '../render/markdown';
import type { CostSummary, ReviewTarget, TokenUsage } from '../review';
import { addUsage, EMPTY_USAGE } from '../review';
import { generateCandidates, type GenerateCandidatesOptions } from './engine';
import { applyFilters, type FilterOptions } from './filter';
import { verifyFindings } from './verify';

export interface RunReviewOptions extends GenerateCandidatesOptions, FilterOptions {
  /** Run the grounding verifier (default true). */
  readonly verify?: boolean;
  readonly verifyConcurrency?: number;
}

export interface ReviewRunResult {
  readonly findings: readonly Finding[];
  readonly candidateCount: number;
  readonly summaryMarkdown: string;
  readonly cost: CostSummary;
  readonly dropped: { readonly verifier: number; readonly filtered: number };
}

class CostAccumulator {
  private readonly byModel = new Map<string, TokenUsage>();

  add(model: string, usage: TokenUsage): void {
    this.byModel.set(model, addUsage(this.byModel.get(model) ?? EMPTY_USAGE, usage));
  }

  summary(): CostSummary {
    const perModel = [...this.byModel.entries()].map(([model, usage]) => modelCost(model, usage));
    const usage = perModel.reduce((acc, m) => addUsage(acc, m.usage), EMPTY_USAGE);
    const costUsd = perModel.reduce((acc, m) => acc + m.costUsd, 0);
    return { usage, costUsd, byModel: perModel };
  }
}

/**
 * The shared review pipeline (stages 4–7 minus transport): generate candidates →
 * grounding verifier → filter chain → render summary + cost. The CLI and the
 * Action both call this; they differ only in ingest (stage 1) and transport
 * (stage 7, posting/printing the result).
 */
export function runReview(
  files: readonly DiffFile[],
  target: ReviewTarget | undefined,
  options: RunReviewOptions = {}
): Effect.Effect<ReviewRunResult, AiError, AiModel> {
  return Effect.gen(function* () {
    const cost = new CostAccumulator();

    const generated = yield* generateCandidates(files, target, options);
    cost.add(generated.model, generated.usage);

    let candidates = generated.findings;
    let verifierDropped = 0;

    if (options.verify !== false && candidates.length > 0) {
      const verified = yield* verifyFindings(candidates, files, {
        concurrency: options.verifyConcurrency,
      });
      candidates = verified.kept;
      verifierDropped = verified.dropped.length;
      if (verified.model) cost.add(verified.model, verified.usage);
    }

    const { kept, dropped } = applyFilters(candidates, options);
    const summary = cost.summary();
    const summaryMarkdown = renderSummaryMarkdown(kept, { cost: summary, headSha: target?.headSha });

    return {
      findings: kept,
      candidateCount: generated.findings.length,
      summaryMarkdown,
      cost: summary,
      dropped: { verifier: verifierDropped, filtered: dropped.length },
    };
  });
}
