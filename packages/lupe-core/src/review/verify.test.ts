import { Effect, Layer } from 'effect';
import { describe, expect, test } from 'vitest';

import { AiModel, type AiModelService, type VerifyResult } from '../ai/model';
import type { DiffFile } from '../diff';
import type { Finding } from '../finding';
import { EMPTY_USAGE } from '../review';
import { verifyFindings } from './verify';

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

const FILES: readonly DiffFile[] = [
  { path: 'a.ts', status: 'modified', binary: false, additions: 1, deletions: 0, hunks: [] },
];

/** Fake AiModel whose verifier returns a caller-supplied verdict per candidate (keyed by title). */
function fakeVerifier(verdicts: Record<string, Partial<VerifyResult>>): Layer.Layer<AiModel> {
  const service: AiModelService = {
    generateFindings: () => Effect.succeed({ findings: [], usage: EMPTY_USAGE, model: 'fake', steps: 0 }),
    verify: ({ candidate }) =>
      Effect.succeed({
        grounded: true,
        reason: '',
        usage: EMPTY_USAGE,
        model: 'fake-verify',
        ...verdicts[candidate.title],
      }),
  };
  return Layer.succeed(AiModel, service);
}

describe('verifyFindings — suggestion validation', () => {
  test('strips a broken suggestion but keeps the (grounded) finding', async () => {
    const candidate = finding({ title: 'real-with-bad-fix', suggestion: 'cond ? 0 : 0' });
    const out = await Effect.runPromise(
      verifyFindings([candidate], FILES).pipe(
        Effect.provide(fakeVerifier({ 'real-with-bad-fix': { grounded: true, suggestionValid: false } }))
      )
    );
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.title).toBe('real-with-bad-fix');
    expect(out.kept[0]!.suggestion).toBeUndefined();
    expect(out.dropped).toHaveLength(0);
  });

  test('keeps a suggestion the verifier judged valid', async () => {
    const candidate = finding({ title: 'real-with-good-fix', suggestion: 'doTheRightThing()' });
    const out = await Effect.runPromise(
      verifyFindings([candidate], FILES).pipe(
        Effect.provide(fakeVerifier({ 'real-with-good-fix': { grounded: true, suggestionValid: true } }))
      )
    );
    expect(out.kept[0]!.suggestion).toBe('doTheRightThing()');
  });

  test('keeps the suggestion when the verifier does not assess it (backward compatible)', async () => {
    const candidate = finding({ title: 'real-unassessed', suggestion: 'keepMe()' });
    const out = await Effect.runPromise(
      verifyFindings([candidate], FILES).pipe(Effect.provide(fakeVerifier({ 'real-unassessed': { grounded: true } })))
    );
    expect(out.kept[0]!.suggestion).toBe('keepMe()');
  });

  test('an ungrounded finding is dropped regardless of suggestion verdict', async () => {
    const candidate = finding({ title: 'spurious', suggestion: 'whatever()' });
    const out = await Effect.runPromise(
      verifyFindings([candidate], FILES).pipe(
        Effect.provide(fakeVerifier({ spurious: { grounded: false, suggestionValid: true } }))
      )
    );
    expect(out.kept).toHaveLength(0);
    expect(out.dropped).toHaveLength(1);
  });
});

describe('verifyFindings — impact-confirmation severity cap', () => {
  test('caps an elevated finding to low when the impact is not confirmed (kept, not dropped)', async () => {
    const candidate = finding({ title: 'unconfirmed-impact', severity: 'high' });
    const out = await Effect.runPromise(
      verifyFindings([candidate], FILES).pipe(
        Effect.provide(fakeVerifier({ 'unconfirmed-impact': { grounded: true, impactConfirmed: false } }))
      )
    );
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0]!.severity).toBe('low');
    expect(out.dropped).toHaveLength(0);
  });

  test('does not raise the severity of an already-low finding', async () => {
    const candidate = finding({ title: 'already-info', severity: 'info' });
    const out = await Effect.runPromise(
      verifyFindings([candidate], FILES).pipe(
        Effect.provide(fakeVerifier({ 'already-info': { grounded: true, impactConfirmed: false } }))
      )
    );
    expect(out.kept[0]!.severity).toBe('info');
  });

  test('leaves severity intact when the impact is confirmed or not assessed', async () => {
    const confirmed = finding({ title: 'confirmed', severity: 'high' });
    const unassessed = finding({ title: 'unassessed', severity: 'medium' });
    const out = await Effect.runPromise(
      verifyFindings([confirmed, unassessed], FILES).pipe(
        Effect.provide(
          fakeVerifier({ confirmed: { grounded: true, impactConfirmed: true }, unassessed: { grounded: true } })
        )
      )
    );
    expect(out.kept.find((f) => f.title === 'confirmed')!.severity).toBe('high');
    expect(out.kept.find((f) => f.title === 'unassessed')!.severity).toBe('medium');
  });
});

describe('verifyFindings — cross-file evidence context', () => {
  test('includes the diff of files the finding cites in evidence, not just the flagged file', async () => {
    const contexts: string[] = [];
    const capturing = Layer.succeed(AiModel, {
      generateFindings: () => Effect.succeed({ findings: [], usage: EMPTY_USAGE, model: 'fake', steps: 0 }),
      verify: ({ evidenceContext }) => {
        contexts.push(evidenceContext);
        return Effect.succeed({ grounded: true, reason: '', usage: EMPTY_USAGE, model: 'fake-verify' });
      },
    } satisfies AiModelService);
    const candidate = finding({ path: 'a.ts', evidence: [{ path: 'b.ts', startLine: 1, endLine: 1 }] });
    const files: readonly DiffFile[] = [
      { path: 'a.ts', status: 'modified', binary: false, additions: 1, deletions: 0, hunks: [] },
      { path: 'b.ts', status: 'modified', binary: false, additions: 1, deletions: 0, hunks: [] },
    ];
    await Effect.runPromise(verifyFindings([candidate], files).pipe(Effect.provide(capturing)));
    // Both the flagged file and the evidence-referenced producer's diff are present.
    expect(contexts[0]).toContain('### a.ts [modified]');
    expect(contexts[0]).toContain('### b.ts [modified]');
  });
});
