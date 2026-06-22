import { renderInlineComment, type AnchoredComment, type DiffFile, type Finding } from "@gigadrive/lupe-core";
import { resolveAnchor } from "@gigadrive/lupe-git";

export interface AnchoredFindings {
  /** Findings that mapped to a valid diff anchor and can be posted inline. */
  readonly comments: readonly AnchoredComment[];
  /** Findings whose range is not part of the diff (would 422); surface in the summary instead. */
  readonly unanchored: readonly Finding[];
}

/** Resolve each finding to a valid (line, side) anchor and render its inline comment body. */
export function anchorFindings(findings: readonly Finding[], files: readonly DiffFile[]): AnchoredFindings {
  const byPath = new Map(files.map((f) => [f.path, f] as const));
  const comments: AnchoredComment[] = [];
  const unanchored: Finding[] = [];

  for (const finding of findings) {
    const file = byPath.get(finding.path);
    const resolution = file ? resolveAnchor(finding, file) : undefined;
    if (resolution?.ok && resolution.anchor) {
      comments.push({ anchor: resolution.anchor, body: renderInlineComment(finding) });
    } else {
      unanchored.push(finding);
    }
  }

  return { comments, unanchored };
}
