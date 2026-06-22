import type { Finding, ReviewRunResult, Severity } from '@gigadrive/lupe-core';
import { SEVERITY_RANK } from '@gigadrive/lupe-core';

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  critical: (s) => c.bold(c.red(s)),
  high: c.red,
  medium: c.yellow,
  low: c.blue,
  info: c.gray,
};

const SEVERITY_GLYPH: Record<Severity, string> = {
  critical: '✖',
  high: '✖',
  medium: '▲',
  low: '•',
  info: '·',
};

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

function formatFinding(f: Finding): string {
  const color = SEVERITY_COLOR[f.severity];
  const head = `${color(`${SEVERITY_GLYPH[f.severity]} ${f.severity.toUpperCase()}`)} ${c.bold(
    `${f.path}:${f.startLine}`
  )} ${c.gray(`[${f.category} · ${Math.round(f.confidence * 100)}%]`)}`;
  const lines = [head, indent(c.bold(f.title), 2), indent(f.message.trim(), 2)];
  if (f.suggestion) {
    lines.push(indent(c.green('suggestion:'), 2));
    lines.push(indent(c.green(f.suggestion.trimEnd()), 4));
  }
  return lines.join('\n');
}

/** Render a full review result for the terminal (`--format md`/default). */
export function formatReview(result: ReviewRunResult): string {
  const out: string[] = [];
  if (result.findings.length === 0) {
    out.push(c.green('✓ No issues found.'));
  } else {
    const sorted = [...result.findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
    for (const f of sorted) {
      out.push(formatFinding(f));
      out.push('');
    }
  }

  if (result.skippedForSize.length > 0) {
    out.push(
      c.yellow(
        `⚠ ${result.skippedForSize.length} changed file(s) NOT reviewed (size budget): ` +
          `${result.skippedForSize.join(', ')}`
      )
    );
    out.push(c.gray('  Raise maxChunks / narrow pathFilters / split the change.'));
  }
  if (result.oversizedFiles.length > 0) {
    out.push(c.gray(`${result.oversizedFiles.length} file(s) larger than one pass, reviewed in isolation.`));
  }

  const cost = result.cost;
  const passes = result.chunkCount > 1 ? ` · ${result.chunkCount} passes` : '';
  out.push(
    c.gray(
      `${result.findings.length} finding(s) · ${result.candidateCount} candidate(s) · ` +
        `${result.dropped.verifier} dropped by verifier · ${result.dropped.filtered} filtered${passes}`
    )
  );
  out.push(
    c.gray(
      `tokens: ${cost.usage.inputTokens} in / ${cost.usage.outputTokens} out / ` +
        `${cost.usage.cacheReadTokens} cached · ~$${cost.costUsd.toFixed(4)}`
    )
  );
  return out.join('\n');
}

export { c as colors };
