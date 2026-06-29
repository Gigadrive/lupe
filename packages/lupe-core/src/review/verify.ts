import { Effect } from 'effect';

import { AiModel, type AiError } from '../ai/model';
import type { DiffFile } from '../diff';
import { SEVERITY_RANK, type Finding, type Severity } from '../finding';
import { serialiseFileDiff } from '../render/diff-prompt';
import { EMPTY_USAGE, addUsage, type TokenUsage } from '../review';

/** Severity ceiling applied when the verifier could not confirm a finding's claimed impact. */
const IMPACT_UNCONFIRMED_CEILING: Severity = 'low';

const VERIFY_SYSTEM = `You are lupe's grounding verifier. You receive a single candidate code-review finding and the relevant code context. Your job is to keep only findings that are CORRECT and GROUNDED in the cited code, and to reject any proposed fix that would not actually work.

Judge these independently:
- grounded: set false when the finding is speculative, not actually reachable (e.g. the flagged code has no live caller, or is dead/test-only so its claimed runtime impact cannot occur), already handled by nearby code, based on code that isn't shown, a pure style preference, or hinges on an unverifiable claim that some OTHER code does not already handle the issue ("the upstream/producer does not strip/validate/guard X", "nothing else checks this") when that other code is not in the context — do NOT accept an absence-of-handling claim on general or library knowledge alone (e.g. "Content-Length is an entity header so it survives"); if the code that would do the handling is not shown, reject. Otherwise also reject when not clearly supported by the context. A finding may be grounded because its *mechanism* is real and visible even if its broader impact is not yet proven (see impactConfirmed). Be skeptical — when in doubt, reject. Keep grounded=true only when the underlying problem is real and visible in the provided code.
- impactConfirmed: judge whether the finding's claimed *impact and severity* are actually established. Set false when the mechanism is real but the stated consequence (crash, OOM, data loss, overbooking, security breach, malformed output) rests on a precondition you cannot see in the context or cited evidence — an off-context caller that triggers the path, an external contract assumed to behave a certain way, unproven attacker-/tenant-controllability of an input, or a triggering input arriving in the problematic form. In particular, when a finding faults a function for mishandling some input/value but the caller or producer that would actually supply that input in the bad form is NOT shown, set impactConfirmed=false (the producer may already sanitise it). Also set false when the impact depends on a consumer, loader, or runtime that is not part of this codebase (an out-of-repo component whose behaviour you can only assume), or when the finding's only real consequence is inaccurate documentation/comments while the code itself behaves correctly and consistently — a wrong doc or a trivial hygiene nit does not justify a severity above low. A finding with impactConfirmed=false is KEPT but capped to a low-severity latent-footgun note, not dropped. Set true when the impact is established by the context; omit when there is no elevated impact claim to judge. (A precondition asserted but not shown is speculation, however plausible.)
- suggestionValid: only when the finding includes a proposed suggestion, set false if that fix is incorrect, incomplete, a no-op, or would not actually resolve the problem (e.g. an expression that always evaluates to the same value, or code that does not compile/parse). A grounded finding with a bad suggestion stays grounded=true — only its broken fix is dropped. Omit the field when there is no suggestion to judge.`;

export interface VerifyOptions {
  /** Bounded concurrency for verifier calls. Default 4. */
  readonly concurrency?: number;
}

export interface VerifyOutcome {
  readonly kept: readonly Finding[];
  readonly dropped: readonly Finding[];
  readonly usage: TokenUsage;
  readonly model?: string;
}

/** Max distinct file diffs to include in a single verifier context (a prompt-size bound). */
const MAX_EVIDENCE_FILES = 6;

function buildEvidenceContext(finding: Finding, byPath: ReadonlyMap<string, DiffFile>): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const pushFile = (path: string): void => {
    if (seen.has(path) || seen.size >= MAX_EVIDENCE_FILES) return;
    const file = byPath.get(path);
    if (file) {
      parts.push(serialiseFileDiff(file));
      seen.add(path);
    }
  };
  // The flagged file first, then any *other* files the finding cites as evidence,
  // so the verifier can check cross-file claims (a producer that already
  // sanitises an input, a caller that guards a path) instead of judging the
  // flagged file in isolation — the main source of in-isolation false positives.
  pushFile(finding.path);
  for (const e of finding.evidence) pushFile(e.path);
  if (finding.evidence.length > 0) {
    parts.push(
      'Cited evidence:\n' +
        finding.evidence
          .map((e) => `- ${e.path}:${e.startLine}-${e.endLine}${e.snippet ? `\n  ${e.snippet}` : ''}`)
          .join('\n')
    );
  }
  return parts.join('\n\n');
}

/**
 * Stage 5 (grounding verifier): run each candidate through a cheaper-model
 * verification pass and drop any finding it cannot tie to the cited code.
 */
export function verifyFindings(
  candidates: readonly Finding[],
  files: readonly DiffFile[],
  options: VerifyOptions = {}
): Effect.Effect<VerifyOutcome, AiError, AiModel> {
  return Effect.gen(function* () {
    const ai = yield* AiModel;
    const byPath = new Map(files.map((f) => [f.path, f] as const));

    const judged = yield* Effect.forEach(
      candidates,
      (candidate) =>
        ai
          .verify({
            task: 'verify',
            system: VERIFY_SYSTEM,
            candidate,
            evidenceContext: buildEvidenceContext(candidate, byPath),
          })
          .pipe(Effect.map((result) => ({ candidate, result }))),
      { concurrency: options.concurrency ?? 4 }
    );

    const kept: Finding[] = [];
    const dropped: Finding[] = [];
    let usage = EMPTY_USAGE;
    let model: string | undefined;
    for (const { candidate, result } of judged) {
      usage = addUsage(usage, result.usage);
      model = result.model;
      if (!result.grounded) {
        dropped.push(candidate);
        continue;
      }
      let finding = candidate;
      // Drop a suggestion the verifier judged broken so a real finding never
      // ships a no-op/incorrect fix (the prose fix in `message` survives).
      if (result.suggestionValid === false && finding.suggestion !== undefined) {
        finding = { ...finding, suggestion: undefined };
      }
      // Cap severity when the claimed impact could not be confirmed: keep the
      // finding as a low-severity latent-footgun note instead of dropping it or
      // publishing an overstated severity.
      if (
        result.impactConfirmed === false &&
        SEVERITY_RANK[finding.severity] < SEVERITY_RANK[IMPACT_UNCONFIRMED_CEILING]
      ) {
        finding = { ...finding, severity: IMPACT_UNCONFIRMED_CEILING };
      }
      kept.push(finding);
    }

    return { kept, dropped, usage, model };
  });
}
