import type { DiffFile } from "../diff";
import type { ReviewTarget } from "../review";
import { renderDiffPrompt } from "../render/diff-prompt";

export type ReviewProfile = "chill" | "assertive";

export interface PathInstruction {
  readonly path: string;
  readonly instructions: string;
}

export interface PromptOptions {
  readonly profile?: ReviewProfile;
  /** Repo coding standards / conventions (CLAUDE.md, style guide, etc.). */
  readonly codingStandards?: string;
  readonly pathInstructions?: readonly PathInstruction[];
  /** Suppressed patterns learned from prior dismissed comments. */
  readonly learnings?: readonly string[];
}

const BASE_SYSTEM = `You are lupe, a precise senior code reviewer. You review a pull-request diff and report only real, defensible problems in the CHANGED code.

What to look for (in priority order):
1. correctness — logic errors, off-by-one, wrong conditionals, broken control flow, incorrect API usage.
2. security — injection, auth/authz gaps, unsafe deserialization, secret leakage, SSRF, path traversal.
3. data-loss / resource-leak — unclosed handles, dropped errors, unbounded growth, race conditions, concurrency hazards.
4. error-handling — swallowed exceptions, missing failure paths, unhandled rejections.
5. performance — N+1 queries, accidental quadratic work, needless allocations in hot paths.
6. api-misuse / maintainability — contract violations, footguns. (advisory)

How to work:
- The user message contains the diff with head line numbers. ONLY comment on lines that appear in the diff.
- Use the read-only tools (readFile, listDir, grep) to gather surrounding context and confirm a problem before reporting it. Prefer to verify over to speculate.
- Detect broadly (favor recall), but each reported finding must be something you can defend with concrete evidence from the code. A separate verifier will drop ungrounded findings, so include real "evidence" entries (path + line range) for every finding.
- Do NOT report: style nits unless they cause bugs, things already handled nearby, hypotheticals not reachable in this code, or pre-existing issues outside the diff.

For each finding set:
- ruleId: "lupe/<category>/<slug>" (e.g. "lupe/security/sql-injection").
- path/startLine/endLine/side: anchor to exact diff lines. side=RIGHT for added/context lines, LEFT for deleted lines.
- severity: critical|high|medium|low|info. category: one of the taxonomy values.
- message: a concise explanation of the problem and the fix, in markdown.
- suggestion: when you can give a concrete drop-in replacement for the anchored range, provide the exact replacement code (no diff markers).
- confidence: 0..1, honestly calibrated. Reserve >0.8 for problems you have verified.
- evidence: the code locations that justify the finding.

If the diff has no real problems, return an empty list.`;

const PROFILE_NOTE: Record<ReviewProfile, string> = {
  chill:
    "\n\nProfile: CHILL. Report only medium+ severity, high-confidence problems. Suppress nitpicks entirely.",
  assertive:
    "\n\nProfile: ASSERTIVE. Surface lower-severity and lower-confidence issues too, clearly marked, but never fabricate.",
};

/** Build the frozen, cacheable system prefix (system + standards + path rules + learnings). */
export function buildSystemPrompt(options: PromptOptions = {}): string {
  let out = BASE_SYSTEM + PROFILE_NOTE[options.profile ?? "chill"];

  if (options.codingStandards && options.codingStandards.trim()) {
    out += `\n\n## Project coding standards\n${options.codingStandards.trim()}`;
  }
  if (options.pathInstructions && options.pathInstructions.length > 0) {
    out += `\n\n## Path-specific instructions`;
    for (const pi of options.pathInstructions) {
      out += `\n- For files matching \`${pi.path}\`: ${pi.instructions}`;
    }
  }
  if (options.learnings && options.learnings.length > 0) {
    out += `\n\n## Learned suppressions (do NOT report these; they were dismissed before)`;
    for (const l of options.learnings) out += `\n- ${l}`;
  }
  return out;
}

/** Build the volatile per-PR user prompt (placed after the cache breakpoint). */
export function buildReviewPrompt(files: readonly DiffFile[], target?: ReviewTarget): string {
  const parts: string[] = [];
  if (target?.title) parts.push(`PR title: ${target.title}`);
  if (target?.body) parts.push(`PR description:\n${target.body}`);
  parts.push(
    `Review the following diff (${files.length} ${files.length === 1 ? "file" : "files"}). ` +
      `Anchor every finding to a line shown below.`,
  );
  parts.push(renderDiffPrompt(files));
  return parts.join("\n\n");
}
