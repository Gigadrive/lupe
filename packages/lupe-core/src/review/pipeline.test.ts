import { Effect, Layer } from 'effect';
import { describe, expect, test } from 'vitest';

import { AiModel, type AiModelService } from '../ai/model';
import type { DiffFile } from '../diff';
import type { Finding } from '../finding';
import { EMPTY_USAGE } from '../review';
import { runReview } from './pipeline';

function finding(o: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'lupe/correctness/x',
    title: 'Real bug',
    path: 'a.ts',
    startLine: 1,
    endLine: 1,
    side: 'RIGHT',
    severity: 'high',
    category: 'correctness',
    message: 'm',
    confidence: 0.9,
    evidence: [],
    ...o,
  };
}

const FILE: DiffFile = {
  path: 'a.ts',
  status: 'modified',
  binary: false,
  additions: 1,
  deletions: 0,
  hunks: [],
};

/** Fake AiModel: returns the given candidates; verifier rejects "SPURIOUS" titles. */
function fakeAi(candidates: readonly Finding[]): Layer.Layer<AiModel> {
  const service: AiModelService = {
    generateFindings: () =>
      Effect.succeed({ findings: candidates, usage: EMPTY_USAGE, model: 'fake-review', steps: 1 }),
    verify: ({ candidate }) =>
      Effect.succeed({
        grounded: !candidate.title.includes('SPURIOUS'),
        reason: '',
        usage: EMPTY_USAGE,
        model: 'fake-verify',
      }),
  };
  return Layer.succeed(AiModel, service);
}

const CANDIDATES = [
  finding({ title: 'Real bug', confidence: 0.9, startLine: 1 }),
  finding({ title: 'SPURIOUS hallucination', confidence: 0.9, startLine: 2 }),
  finding({ title: 'Low confidence guess', confidence: 0.2, startLine: 3 }),
];

describe('runReview pipeline', () => {
  test('verifier drops ungrounded, filter drops low-confidence', async () => {
    const result = await Effect.runPromise(
      runReview([FILE], undefined, { confidenceThreshold: 0.5 }).pipe(Effect.provide(fakeAi(CANDIDATES)))
    );
    expect(result.candidateCount).toBe(3);
    expect(result.dropped.verifier).toBe(1); // SPURIOUS
    expect(result.dropped.filtered).toBe(1); // low confidence
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.title).toBe('Real bug');
    expect(result.summaryMarkdown).toContain('lupe review');
  });

  test('skipping the verifier keeps ungrounded findings (proves the verifier matters)', async () => {
    const result = await Effect.runPromise(
      runReview([FILE], undefined, { verify: false, confidenceThreshold: 0.5 }).pipe(Effect.provide(fakeAi(CANDIDATES)))
    );
    expect(result.dropped.verifier).toBe(0);
    expect(result.findings).toHaveLength(2); // Real bug + SPURIOUS (both >= 0.5)
  });

  test('cost summary aggregates per model', async () => {
    const result = await Effect.runPromise(runReview([FILE], undefined, {}).pipe(Effect.provide(fakeAi([finding()]))));
    expect(result.cost.byModel.map((m) => m.model).sort()).toEqual(['fake-review', 'fake-verify']);
  });
});
