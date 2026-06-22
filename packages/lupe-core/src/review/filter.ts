import type { Finding } from '../finding';
import { SEVERITY_RANK, isAdvisory } from '../finding';

export interface FilterOptions {
  /** Drop findings below this confidence (0..1). Default 0.5. */
  readonly confidenceThreshold?: number;
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
 * The post-generation filter chain: dedup → confidence threshold →
 * advisory/learnings suppression → severity-ranked cap. Findings are cheap to
 * generate but expensive to publish; this is where they earn their place.
 */
export function applyFilters(findings: readonly Finding[], options: FilterOptions = {}): FilterResult {
  const threshold = options.confidenceThreshold ?? 0.5;
  const learnings = (options.learnings ?? []).map((l) => l.toLowerCase()).filter(Boolean);
  const dropped: Finding[] = [];

  let kept = dedupeFindings(findings).filter((f) => {
    if (f.confidence < threshold) {
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
