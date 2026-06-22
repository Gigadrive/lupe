import type { Category, Finding, Severity } from '../finding';
import { SEVERITY_RANK, isAdvisory } from '../finding';
import { globToRegExp } from '../glob';

/** A confidence/severity gate, scoped to a category or a path glob. */
export interface CategoryThreshold {
  /** Drop findings in this category below this confidence (0..1). */
  readonly minConfidence?: number;
  /** Drop findings in this category less severe than this (e.g. "high" keeps critical+high). */
  readonly minSeverity?: Severity;
}

/** A category-style gate that applies only to files matching `glob`. */
export interface PathThreshold extends CategoryThreshold {
  readonly glob: string;
}

export interface FilterOptions {
  /** Drop findings below this confidence (0..1). Default 0.5. The global floor. */
  readonly confidenceThreshold?: number;
  /** Per-category confidence/severity gates (override the global floor for that category). */
  readonly categoryThresholds?: Partial<Record<Category, CategoryThreshold>>;
  /** Per-path-glob gates (highest precedence; last matching rule wins). */
  readonly pathThresholds?: readonly PathThreshold[];
  /** Cap the number of kept findings (most severe + confident first). */
  readonly maxFindings?: number;
  /** Learned suppression substrings (from prior dismissed comments). */
  readonly learnings?: readonly string[];
  /** Drop advisory (style/docs/test/maintainability) findings entirely. */
  readonly suppressAdvisory?: boolean;
}

export interface FilterResult {
  readonly kept: readonly Finding[];
  readonly dropped: readonly Finding[];
}

function dedupeKey(f: Finding): string {
  return `${f.path}:${f.startLine}:${f.endLine}:${f.ruleId}`;
}

/** Collapse duplicate findings (same location + rule), keeping the most confident. */
export function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();
  for (const f of findings) {
    const key = dedupeKey(f);
    const existing = byKey.get(key);
    if (!existing || f.confidence > existing.confidence) byKey.set(key, f);
  }
  return [...byKey.values()];
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.confidence - a.confidence ||
      a.path.localeCompare(b.path) ||
      a.startLine - b.startLine
  );
}

/**
 * Resolve the effective confidence/severity gate for a finding.
 * Precedence: path glob > category > global confidence floor. A more specific
 * rule only overrides the fields it sets, so an unset field falls through.
 */
function effectiveGate(
  finding: Finding,
  globalConfidence: number,
  categoryThresholds: Partial<Record<Category, CategoryThreshold>> | undefined,
  pathRules: ReadonlyArray<{ readonly re: RegExp; readonly rule: PathThreshold }>
): { minConfidence: number; minSeverity?: Severity } {
  let minConfidence = globalConfidence;
  let minSeverity: Severity | undefined;

  const cat = categoryThresholds?.[finding.category];
  if (cat?.minConfidence !== undefined) minConfidence = cat.minConfidence;
  if (cat?.minSeverity !== undefined) minSeverity = cat.minSeverity;

  // Last matching path rule wins (mirrors compress.ts matchesFilters semantics).
  for (const { re, rule } of pathRules) {
    if (!re.test(finding.path)) continue;
    if (rule.minConfidence !== undefined) minConfidence = rule.minConfidence;
    if (rule.minSeverity !== undefined) minSeverity = rule.minSeverity;
  }

  return { minConfidence, minSeverity };
}

/**
 * The post-generation filter chain: dedup → confidence/severity threshold
 * (global, per-category, or per-path) → advisory/learnings suppression →
 * severity-ranked cap. Findings are cheap to generate but expensive to publish;
 * this is where they earn their place. With no threshold config, behaviour is
 * identical to the prior global-confidence-only filter.
 */
export function applyFilters(findings: readonly Finding[], options: FilterOptions = {}): FilterResult {
  const globalConfidence = options.confidenceThreshold ?? 0.5;
  const learnings = (options.learnings ?? []).map((l) => l.toLowerCase()).filter(Boolean);
  const pathRules = (options.pathThresholds ?? []).map((rule) => ({ re: globToRegExp(rule.glob), rule }));
  const dropped: Finding[] = [];

  let kept = dedupeFindings(findings).filter((f) => {
    const { minConfidence, minSeverity } = effectiveGate(f, globalConfidence, options.categoryThresholds, pathRules);
    if (f.confidence < minConfidence) {
      dropped.push(f);
      return false;
    }
    if (minSeverity !== undefined && SEVERITY_RANK[f.severity] > SEVERITY_RANK[minSeverity]) {
      dropped.push(f);
      return false;
    }
    if (options.suppressAdvisory && isAdvisory(f)) {
      dropped.push(f);
      return false;
    }
    const haystack = `${f.title} ${f.message} ${f.ruleId}`.toLowerCase();
    if (learnings.some((l) => haystack.includes(l))) {
      dropped.push(f);
      return false;
    }
    return true;
  });

  kept = sortFindings(kept);

  if (options.maxFindings !== undefined && kept.length > options.maxFindings) {
    dropped.push(...kept.slice(options.maxFindings));
    kept = kept.slice(0, options.maxFindings);
  }

  return { kept, dropped };
}
