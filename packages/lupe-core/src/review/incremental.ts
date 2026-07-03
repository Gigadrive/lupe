import type { Finding } from '../finding';
import { fromDigest, type FindingDigest } from '../render/markdown';

/**
 * Merge the findings from an incremental review slice with the findings that
 * were standing before it. Prior findings on a path that was reviewed this run
 * are superseded by `fresh`; prior findings on untouched paths are carried
 * forward (rendered summary-only). The result is deduped by location + rule,
 * keeping the most confident.
 */
export function mergeIncrementalFindings(
  prior: readonly FindingDigest[],
  fresh: readonly Finding[],
  reviewedPaths: ReadonlySet<string>
): Finding[] {
  const carried = prior.filter((d) => !reviewedPaths.has(d.path)).map(fromDigest);
  const byKey = new Map<string, Finding>();
  for (const f of [...fresh, ...carried]) {
    const key = `${f.path}:${f.startLine}:${f.endLine}:${f.ruleId}`;
    const existing = byKey.get(key);
    if (!existing || f.confidence > existing.confidence) byKey.set(key, f);
  }
  return [...byKey.values()];
}
