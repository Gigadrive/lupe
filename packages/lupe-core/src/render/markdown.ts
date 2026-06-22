import type { Description, Finding, Severity } from '../finding';
import { SEVERITY_RANK, isAdvisory } from '../finding';
import type { CostSummary } from '../review';

/** Hidden marker used to find-and-update the single sticky summary comment. */
export const SUMMARY_MARKER = '<!-- lupe-summary -->';

/** Visible marker in every inline comment footer — lets the transport find lupe's own threads. */
export const INLINE_MARKER = '🔍 lupe';

const STATE_PREFIX = '<!-- lupe-state:';
const STATE_SUFFIX = '-->';

/** Persisted, machine-readable review state embedded in the sticky comment. */
export interface LupeReviewState {
  readonly version: number;
  readonly lastReviewedSha?: string;
  readonly findingCount?: number;
}

export function encodeState(state: LupeReviewState): string {
  return `${STATE_PREFIX} ${JSON.stringify(state)} ${STATE_SUFFIX}`;
}

export function parseState(body: string): LupeReviewState | undefined {
  const start = body.indexOf(STATE_PREFIX);
  if (start === -1) return undefined;
  const end = body.indexOf(STATE_SUFFIX, start + STATE_PREFIX.length);
  if (end === -1) return undefined;
  const json = body.slice(start + STATE_PREFIX.length, end).trim();
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object') return parsed as LupeReviewState;
  } catch {
    return undefined;
  }
  return undefined;
}

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🛑',
  high: '🔴',
  medium: '🟠',
  low: '🟡',
  info: '🔵',
};

export function severityBadge(severity: Severity): string {
  return `${SEVERITY_EMOJI[severity]} **${severity}**`;
}

/** Build a GitHub ```suggestion block. */
export function suggestionBlock(code: string): string {
  const body = code.replace(/\n+$/, '');
  return ['```suggestion', body, '```'].join('\n');
}

/** Render the body of a single anchored inline comment. */
export function renderInlineComment(finding: Finding): string {
  const lines: string[] = [];
  lines.push(`${severityBadge(finding.severity)} · \`${finding.category}\` — **${finding.title}**`);
  lines.push('');
  lines.push(finding.message.trim());
  if (finding.suggestion && finding.suggestion.trim().length > 0) {
    lines.push('');
    lines.push(suggestionBlock(finding.suggestion));
  }
  const pct = Math.round(finding.confidence * 100);
  lines.push('');
  lines.push(`<sub>${INLINE_MARKER} · \`${finding.ruleId}\` · confidence ${pct}%</sub>`);
  return lines.join('\n');
}

function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    if (a.path !== b.path) return a.path.localeCompare(b.path);
    return a.startLine - b.startLine;
  });
}

export interface SummaryOptions {
  readonly title?: string;
  readonly cost?: CostSummary;
  readonly state?: LupeReviewState;
  readonly headSha?: string;
  /** Number of model passes used (large-PR map-reduce); only surfaced when > 1. */
  readonly chunkCount?: number;
  /** Files left unreviewed because the chunk ceiling was hit (surfaced, never silent). */
  readonly skippedForSize?: readonly string[];
  /** Files individually larger than one pass (reviewed in isolation). */
  readonly oversizedFiles?: readonly string[];
}

/** Render the single sticky `<!-- lupe-summary -->` comment. */
export function renderSummaryMarkdown(findings: readonly Finding[], options: SummaryOptions = {}): string {
  const counts = countBySeverity(findings);
  const actionable = findings.filter((f) => !isAdvisory(f)).length;
  const advisory = findings.length - actionable;

  const out: string[] = [];
  out.push(SUMMARY_MARKER);
  out.push(`## 🔍 ${options.title ?? 'lupe review'}`);
  out.push('');

  if (findings.length === 0) {
    out.push('No issues found. ✅');
  } else {
    out.push(
      `Found **${findings.length}** ${findings.length === 1 ? 'finding' : 'findings'} ` +
        `(${actionable} actionable, ${advisory} advisory).`
    );
    out.push('');
    out.push('| Severity | Count |');
    out.push('| --- | --- |');
    for (const sev of ['critical', 'high', 'medium', 'low', 'info'] as const) {
      if (counts[sev] > 0) out.push(`| ${SEVERITY_EMOJI[sev]} ${sev} | ${counts[sev]} |`);
    }
    out.push('');
    out.push('<details><summary>All findings</summary>');
    out.push('');
    for (const f of sortFindings(findings)) {
      const loc = `\`${f.path}:${f.startLine}\``;
      const pct = Math.round(f.confidence * 100);
      out.push(`- ${SEVERITY_EMOJI[f.severity]} ${loc} — ${f.title} <sub>(${f.category} · ${pct}%)</sub>`);
    }
    out.push('');
    out.push('</details>');
  }

  if (options.skippedForSize && options.skippedForSize.length > 0) {
    out.push('');
    out.push(
      `> ⚠️ **${options.skippedForSize.length} changed file(s) were NOT reviewed** — the diff exceeded the ` +
        'size budget. Raise `max-chunks` / `maxChunks`, narrow `pathFilters`, or split the PR:'
    );
    for (const p of options.skippedForSize) out.push(`> - \`${p}\``);
  }

  if (options.oversizedFiles && options.oversizedFiles.length > 0) {
    out.push('');
    out.push(
      `> ℹ️ ${options.oversizedFiles.length} file(s) are individually larger than one review pass ` +
        'and were reviewed in isolation:'
    );
    for (const p of options.oversizedFiles) out.push(`> - \`${p}\``);
  }

  if (options.chunkCount && options.chunkCount > 1) {
    out.push('');
    out.push(`<sub>Large diff — reviewed in ${options.chunkCount} passes.</sub>`);
  }

  if (options.cost) {
    const c = options.cost;
    out.push('');
    out.push(
      `<sub>💸 ${c.usage.inputTokens.toLocaleString()} in · ` +
        `${c.usage.outputTokens.toLocaleString()} out · ` +
        `${c.usage.cacheReadTokens.toLocaleString()} cached · ~$${c.costUsd.toFixed(4)}</sub>`
    );
  }

  if (options.state || options.headSha) {
    const state: LupeReviewState = options.state ?? {
      version: 1,
      lastReviewedSha: options.headSha,
      findingCount: findings.length,
    };
    out.push('');
    out.push(encodeState(state));
  }

  return out.join('\n');
}

/** Plain-markdown rendering for the CLI `--print` path (colourised separately). */
export function renderTerminal(findings: readonly Finding[]): string {
  if (findings.length === 0) return '✅ No issues found.';
  const out: string[] = [];
  for (const f of sortFindings(findings)) {
    out.push(`${severityBadge(f.severity)} ${f.path}:${f.startLine}  ${f.title}`);
    out.push(`  ${f.category} · ${f.ruleId} · confidence ${Math.round(f.confidence * 100)}%`);
    out.push(`  ${f.message.trim().replace(/\n/g, '\n  ')}`);
    if (f.suggestion) {
      out.push('  suggestion:');
      out.push(f.suggestion.replace(/^/gm, '    '));
    }
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------

const TYPE_EMOJI: Record<string, string> = {
  feat: '✨',
  fix: '🐛',
  refactor: '♻️',
  docs: '📖',
  test: '✅',
  chore: '🔧',
  perf: '⚡',
  ci: '👷',
  deps: '📦',
};

/** Render a generated PR description as a GitHub-compatible markdown string. */
export function renderDescription(description: Description): string {
  const emoji = TYPE_EMOJI[description.type] ?? '📝';
  const breaking = description.breaking ? '⚠️ **Breaking**' : null;

  const out: string[] = [];
  out.push(`## ${emoji} ${description.title}`);
  out.push('');
  out.push(description.summary);
  out.push('');
  out.push('| | |');
  out.push('| --- | --- |');
  out.push(`| Type | ${description.type} |`);
  if (breaking) out.push(`| ${breaking} | yes |`);
  out.push(`| Tests written | ${description.testsWritten ? 'yes' : 'no'} |`);
  if (description.notes) {
    out.push('');
    out.push('### Notes');
    out.push('');
    out.push(description.notes);
  }
  return out.join('\n');
}
