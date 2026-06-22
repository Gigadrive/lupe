import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';

/**
 * Auto-ingest of repo-local coding-standards / rule files into the review
 * prompt's `codingStandards` slot — parity with what every competitor reads out
 * of the box (CLAUDE.md / AGENTS.md / .cursorrules / .cursor/rules / Gemini /
 * Copilot). Pure local file reads; the result joins the frozen, cached prompt
 * prefix, so the output is deterministic (byte-stable) and byte-capped.
 */

export interface DiscoverStandardsOptions {
  /** Repo root (CLI cwd or the Action's GITHUB_WORKSPACE checkout). */
  readonly rootDir: string;
  /** Explicit standards from `.lupe.yaml` — highest precedence. */
  readonly explicit?: string;
  /** Cap on total ingested characters (joins the per-call cached prefix). Default 16_000. */
  readonly maxBytes?: number;
}

/** Default byte cap — large rule files would bloat every cached request. */
const DEFAULT_MAX_BYTES = 16_000;

function readFileSafe(file: string): string | undefined {
  try {
    if (!existsSync(file)) return undefined;
    const content = readFileSync(file, 'utf8');
    return content.trim().length > 0 ? content.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** `.cursor/rules/*.mdc`, sorted for deterministic ordering. */
function listCursorRules(rootDir: string): string[] {
  const dir = nodePath.join(rootDir, '.cursor', 'rules');
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.mdc'))
      .sort()
      .map((f) => `.cursor/rules/${f}`);
  } catch {
    return [];
  }
}

/**
 * Discover and concatenate repo-local coding-standards files into a single
 * provenance-headed block, or `undefined` when none exist. Deterministic order +
 * byte cap keep the Anthropic prompt-cache prefix valid across chunks.
 */
export function discoverCodingStandards(options: DiscoverStandardsOptions): string | undefined {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  // Dedup by content: CLAUDE.md/AGENTS.md are frequently symlinks/copies, and
  // ingesting both would burn the byte budget on identical rules.
  const seenContent = new Set<string>();
  const sections: string[] = [];
  if (options.explicit && options.explicit.trim().length > 0) {
    const explicit = options.explicit.trim();
    seenContent.add(explicit);
    sections.push(`## From .lupe.yaml\n${explicit}`);
  }

  // Precedence order; `.cursor/rules/*.mdc` is spliced in after `.cursorrules`.
  const relPaths = [
    'CLAUDE.md',
    'AGENTS.md',
    '.cursorrules',
    ...listCursorRules(options.rootDir),
    '.gemini/styleguide.md',
    '.github/copilot-instructions.md',
  ];

  for (const rel of relPaths) {
    const content = readFileSafe(nodePath.join(options.rootDir, rel));
    if (!content || seenContent.has(content)) continue;
    seenContent.add(content);
    sections.push(`## From ${rel}\n${content}`);
  }

  if (sections.length === 0) return undefined;

  const parts: string[] = [];
  let total = 0;
  for (const section of sections) {
    if (total + section.length > maxBytes) {
      parts.push(`## (coding standards truncated at ${maxBytes} chars)`);
      break;
    }
    parts.push(section);
    total += section.length + 2;
  }
  return parts.join('\n\n');
}
