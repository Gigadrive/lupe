import { Effect } from "effect";
import type { DiffFile } from "../diff";
import type { Finding } from "../finding";
import { AiModel, type AiError } from "../ai/model";
import { serialiseFileDiff } from "../render/diff-prompt";
import { EMPTY_USAGE, addUsage, type TokenUsage } from "../review";

const VERIFY_SYSTEM = `You are lupe's grounding verifier. You receive a single candidate code-review finding and the relevant code context. Your job is to keep only findings that are CORRECT and GROUNDED in the cited code.

Set grounded=false when the finding is: speculative, not actually reachable, already handled by nearby code, based on code that isn't shown, a pure style preference, or otherwise not clearly supported by the context. Be skeptical — when in doubt, reject. Keep grounded=true only when the problem is real and visible in the provided code.`;

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

function buildEvidenceContext(finding: Finding, file: DiffFile | undefined): string {
  const parts: string[] = [];
  if (file) parts.push(serialiseFileDiff(file));
  if (finding.evidence.length > 0) {
    parts.push(
      "Cited evidence:\n" +
        finding.evidence
          .map((e) => `- ${e.path}:${e.startLine}-${e.endLine}${e.snippet ? `\n  ${e.snippet}` : ""}`)
          .join("\n"),
    );
  }
  return parts.join("\n\n");
}

/**
 * Stage 5 (grounding verifier): run each candidate through a cheaper-model
 * verification pass and drop any finding it cannot tie to the cited code.
 */
export function verifyFindings(
  candidates: readonly Finding[],
  files: readonly DiffFile[],
  options: VerifyOptions = {},
): Effect.Effect<VerifyOutcome, AiError, AiModel> {
  return Effect.gen(function* () {
    const ai = yield* AiModel;
    const byPath = new Map(files.map((f) => [f.path, f] as const));

    const judged = yield* Effect.forEach(
      candidates,
      (candidate) =>
        ai
          .verify({
            task: "verify",
            system: VERIFY_SYSTEM,
            candidate,
            evidenceContext: buildEvidenceContext(candidate, byPath.get(candidate.path)),
          })
          .pipe(Effect.map((result) => ({ candidate, result }))),
      { concurrency: options.concurrency ?? 4 },
    );

    const kept: Finding[] = [];
    const dropped: Finding[] = [];
    let usage = EMPTY_USAGE;
    let model: string | undefined;
    for (const { candidate, result } of judged) {
      usage = addUsage(usage, result.usage);
      model = result.model;
      if (result.grounded) kept.push(candidate);
      else dropped.push(candidate);
    }

    return { kept, dropped, usage, model };
  });
}
