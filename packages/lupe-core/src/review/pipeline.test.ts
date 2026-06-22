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
    generateDescription: ({ prompt }) =>
      Effect.succeed({
        description: {
          title: 'Generated PR',
          summary: prompt.slice(0, 50),
          type: 'feat',
          breaking: false,
          testsWritten: false,
        },
        usage: EMPTY_USAGE,
        model: 'fake-describe',
      }),
  };
  return Layer.succeed(AiModel, service);
}

const CANDIDATES = [
  finding({ title: 'Real bug', confidence: 0.9, startLine: 1 }),
  finding({ title: 'SPURIOUS hallucination', confidence: 0.9, startLine: 2 }),
  finding({ title: 'Low confidence guess', confidence: 0.2, startLine: 3 }),
];

function mkFile(path: string): DiffFile {
  return { path, status: 'modified', binary: false, additions: 1, deletions: 0, hunks: [] };
}

/** Like fakeAi, but records the frozen system prefix each generation call receives. */
function capturingAi(
  candidates: readonly Finding[],
  usage = EMPTY_USAGE
): { layer: Layer.Layer<AiModel>; systems: string[] } {
  const systems: string[] = [];
  const service: AiModelService = {
    generateFindings: (input) => {
      systems.push(input.system);
      return Effect.succeed({ findings: candidates, usage, model: 'fake-review', steps: 1 });
    },
    verify: ({ candidate }) =>
      Effect.succeed({
        grounded: !candidate.title.includes('SPURIOUS'),
        reason: '',
        usage: EMPTY_USAGE,
        model: 'fake-verify',
      }),
    generateDescription: ({ prompt }) =>
      Effect.succeed({
        description: {
          title: 'Generated PR',
          summary: prompt.slice(0, 50),
          type: 'feat',
          breaking: false,
          testsWritten: false,
        },
        usage: EMPTY_USAGE,
        model: 'fake-describe',
      }),
  };
  return { layer: Layer.succeed(AiModel, service), systems };
}

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

  test('single-chunk path stays one pass with nothing skipped', async () => {
    const result = await Effect.runPromise(runReview([FILE], undefined, {}).pipe(Effect.provide(fakeAi([finding()]))));
    expect(result.chunkCount).toBe(1);
    expect(result.skippedForSize).toEqual([]);
    expect(result.oversizedFiles).toEqual([]);
  });
});

describe('runReview large-PR chunking', () => {
  test('reviews every chunk, merges + dedups, sums usage, reuses one frozen prefix', async () => {
    const files = [mkFile('a.ts'), mkFile('b.ts'), mkFile('c.ts')];
    const candidate = [finding({ title: 'Real bug', confidence: 0.9, path: 'a.ts', startLine: 1 })];
    const usage = { inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0 };
    const { layer, systems } = capturingAi(candidate, usage);

    // maxChunkTokens: 1 forces one model pass per file.
    const result = await Effect.runPromise(
      runReview(files, undefined, { maxChunkTokens: 1 }).pipe(Effect.provide(layer))
    );

    expect(result.chunkCount).toBe(3);
    expect(systems).toHaveLength(3); // one generation call per chunk
    expect(new Set(systems).size).toBe(1); // identical prefix across chunks → prompt-cache safe
    expect(result.candidateCount).toBe(3); // one candidate per chunk, before dedup
    expect(result.findings).toHaveLength(1); // identical findings collapse
    const review = result.cost.byModel.find((m) => m.model === 'fake-review');
    expect(review?.usage.inputTokens).toBe(30); // summed across the 3 passes
  });

  test('files beyond the chunk ceiling are reported, never silently dropped', async () => {
    const files = [mkFile('a.ts'), mkFile('b.ts'), mkFile('c.ts')];
    const { layer } = capturingAi([finding({ path: 'a.ts' })]);
    const result = await Effect.runPromise(
      runReview(files, undefined, { maxChunkTokens: 1, maxChunks: 2 }).pipe(Effect.provide(layer))
    );
    expect(result.chunkCount).toBe(2);
    expect(result.skippedForSize).toEqual(['c.ts']);
    expect(result.summaryMarkdown).toContain('NOT reviewed');
  });
});
