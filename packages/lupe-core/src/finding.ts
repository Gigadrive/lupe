import { z } from 'zod';

import { fnv1a } from './util/hash';

/**
 * The Finding model is the single source of truth for everything the reviewer
 * emits. The same Zod schema is used for (a) the AI SDK structured-output
 * (`Output.array(findingSchema)`), (b) the `claude -p --json-schema` /
 * `codex exec --output-schema` local backends, and (c) the SARIF + markdown
 * renderers. Keep it provider-agnostic and serialisable.
 */

export const Severity = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export type Severity = z.infer<typeof Severity>;

/**
 * Coarse taxonomy used for routing, suppression, and stable SARIF rule ids.
 * `style`, `test`, and `docs` are advisory-by-default (never CI-blocking).
 */
export const Category = z.enum([
  'correctness',
  'security',
  'performance',
  'concurrency',
  'error-handling',
  'resource-leak',
  'api-misuse',
  'data-loss',
  'maintainability',
  'style',
  'test',
  'docs',
]);
export type Category = z.infer<typeof Category>;

/** Categories that are advisory by default — surfaced, but never block CI. */
export const ADVISORY_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'style',
  'maintainability',
  'docs',
  'test',
]);

/** GitHub review-comment side. RIGHT = head (additions), LEFT = base (deletions). */
export const Side = z.enum(['LEFT', 'RIGHT']);
export type Side = z.infer<typeof Side>;

/**
 * A piece of code the model cites to ground a finding. The grounding verifier
 * drops any finding whose evidence cannot be tied back to real code.
 */
export const Evidence = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  snippet: z.string().optional(),
  note: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

/**
 * A candidate finding as emitted by the model. `confidence` and `evidence`
 * drive the downstream filter chain; `suggestion`, when present, renders as a
 * GitHub ```suggestion block.
 */
export const Finding = z.object({
  /** Stable taxonomy id, conventionally `lupe/<category>/<slug>`. */
  ruleId: z
    .string()
    .min(1)
    .regex(/^[a-z0-9/_-]+$/, 'ruleId must be kebab/slash lower-case'),
  title: z.string().min(1).max(160),
  path: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  side: Side.default('RIGHT'),
  severity: Severity,
  category: Category,
  /** Markdown body of the comment. */
  message: z.string().min(1),
  /** Replacement code for the anchored range, rendered as a ```suggestion block. */
  suggestion: z.string().optional(),
  /** 0..1; the filter chain gates on this. */
  confidence: z.number().min(0).max(1),
  evidence: z.array(Evidence).default([]),
});
export type Finding = z.infer<typeof Finding>;

/** Array schema handed to `Output.array(...)` / `--json-schema`. */
export const Findings = z.array(Finding);
export type Findings = z.infer<typeof Findings>;

/** SARIF severity level for a finding category/severity. */
export type SarifLevel = 'error' | 'warning' | 'note';

export function severityToSarifLevel(severity: Severity): SarifLevel {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
      return 'note';
  }
}

/** Rank used for sorting + "worst severity" computations. Lower = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function isAdvisory(finding: Pick<Finding, 'category'>): boolean {
  return ADVISORY_CATEGORIES.has(finding.category);
}

/**
 * Findings eligible to be posted as inline comments — those at or above
 * `minSeverity` (a transport gate distinct from the publication filter). With
 * no threshold, all findings are eligible; the rest stay summary-only.
 */
export function findingsForInlineComment(findings: readonly Finding[], minSeverity?: Severity): readonly Finding[] {
  if (minSeverity === undefined) return findings;
  const ceiling = SEVERITY_RANK[minSeverity];
  return findings.filter((f) => SEVERITY_RANK[f.severity] <= ceiling);
}

/**
 * Stable cross-run identity for a finding, used to avoid re-posting the same
 * finding inline on a later run (e.g. after a force-push falls back to the full
 * diff). Keyed on location + side + rule only — deliberately reconstructable
 * from a persisted {@link FindingDigest} (which has no `message`).
 */
export function findingContentKey(f: Pick<Finding, 'path' | 'startLine' | 'endLine' | 'side' | 'ruleId'>): string {
  return fnv1a(`${f.path}:${f.startLine}:${f.endLine}:${f.side}:${f.ruleId}`);
}

/** Normalise a free-form ruleId into the canonical `lupe/<category>/<slug>` shape. */
export function canonicalRuleId(category: Category, ruleId: string): string {
  if (ruleId.startsWith('lupe/')) return ruleId;
  const slug = ruleId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `lupe/${category}/${slug || 'general'}`;
}

/**
 * JSON Schema for the findings array — used by the local CLI backends
 * (`claude -p --json-schema`, `codex exec --output-schema`).
 */
export function findingsJsonSchema(): unknown {
  return z.toJSONSchema(Findings, { target: 'draft-7' });
}
