import { Effect } from 'effect';

import {
  AnchorError,
  type Anchor,
  type CommentableLine,
  type DiffFile,
  type Finding,
  type Side,
} from '@gigadrive/lupe-core';

/**
 * GitHub rejects review comments whose line is not part of the diff
 * (HTTP 422 "line must be part of the diff"). This module computes the set of
 * commentable (line, side) pairs from a parsed diff and maps a finding onto a
 * valid anchor — or fails with a typed AnchorError.
 *
 * Convention: additions/context are commentable on RIGHT (head line numbers),
 * deletions on LEFT (base line numbers).
 */

export function commentableLines(file: DiffFile): CommentableLine[] {
  const out: CommentableLine[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add' && line.newLine !== undefined) {
        out.push({ line: line.newLine, side: 'RIGHT' });
      } else if (line.kind === 'context' && line.newLine !== undefined) {
        out.push({ line: line.newLine, side: 'RIGHT' });
      } else if (line.kind === 'del' && line.oldLine !== undefined) {
        out.push({ line: line.oldLine, side: 'LEFT' });
      }
    }
  }
  return out;
}

export function commentableLineSet(file: DiffFile, side: Side): ReadonlySet<number> {
  const set = new Set<number>();
  for (const c of commentableLines(file)) {
    if (c.side === side) set.add(c.line);
  }
  return set;
}

export interface AnchorResolution {
  readonly ok: boolean;
  readonly anchor?: Anchor;
  readonly reason?: string;
}

/**
 * Map a finding to a valid anchor. Prefers a multi-line anchor when both
 * endpoints are in the diff, otherwise collapses to the nearest commentable
 * line within [startLine, endLine]. Returns `{ ok: false }` when the finding's
 * range touches no diff line on its side (the 422 case).
 */
export function resolveAnchor(
  finding: Pick<Finding, 'path' | 'startLine' | 'endLine' | 'side'>,
  file: DiffFile
): AnchorResolution {
  const side: Side = finding.side ?? 'RIGHT';
  const lo = Math.min(finding.startLine, finding.endLine);
  const hi = Math.max(finding.startLine, finding.endLine);
  const commentable = commentableLineSet(file, side);

  if (commentable.size === 0) {
    return { ok: false, reason: `no commentable lines on side ${side} for ${file.path}` };
  }

  // Anchor (end) line: prefer hi, else the greatest commentable line <= hi within range.
  let endLine: number | undefined;
  if (commentable.has(hi)) {
    endLine = hi;
  } else {
    for (let n = hi; n >= lo; n--) {
      if (commentable.has(n)) {
        endLine = n;
        break;
      }
    }
  }
  if (endLine === undefined) {
    return {
      ok: false,
      reason: `lines ${lo}-${hi} on side ${side} are not part of the diff for ${file.path}`,
    };
  }

  // Start line for multi-line comments: the smallest commentable line >= lo and < endLine.
  let startLine: number | undefined;
  for (let n = lo; n < endLine; n++) {
    if (commentable.has(n)) {
      startLine = n;
      break;
    }
  }

  const anchor: Anchor =
    startLine !== undefined
      ? { path: file.path, line: endLine, side, startLine, startSide: side }
      : { path: file.path, line: endLine, side };

  return { ok: true, anchor };
}

/** Effectful variant: fail with a typed AnchorError instead of returning a flag. */
export function toAnchor(
  finding: Pick<Finding, 'path' | 'startLine' | 'endLine' | 'side'>,
  file: DiffFile
): Effect.Effect<Anchor, AnchorError> {
  const resolution = resolveAnchor(finding, file);
  if (resolution.ok && resolution.anchor) return Effect.succeed(resolution.anchor);
  return Effect.fail(
    new AnchorError({
      message: resolution.reason ?? 'could not anchor finding',
      path: finding.path,
      line: finding.endLine,
      side: finding.side,
    })
  );
}
