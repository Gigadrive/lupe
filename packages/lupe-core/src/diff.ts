import type { Side } from "./finding";

/**
 * Shared diff domain model. Types live in core so the engine can reason about
 * diffs without depending on the parser (which lives in @gigadrive/lupe-git).
 */

export type DiffLineKind = "add" | "del" | "context";

export interface DiffLine {
  readonly kind: DiffLineKind;
  /** Line content without the leading +/-/space marker. */
  readonly content: string;
  /** 1-based line number in the base (old) file; present for `del` and `context`. */
  readonly oldLine?: number;
  /** 1-based line number in the head (new) file; present for `add` and `context`. */
  readonly newLine?: number;
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  /** Optional section heading carried after the `@@ ... @@` marker. */
  readonly section?: string;
  readonly lines: readonly DiffLine[];
}

export type DiffStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFile {
  /** New path (head). For deletions this is the removed path. */
  readonly path: string;
  /** Old path (base) when renamed/deleted. */
  readonly oldPath?: string;
  readonly status: DiffStatus;
  readonly binary: boolean;
  readonly hunks: readonly DiffHunk[];
  /** Lines added / removed (for ranking + budgeting). */
  readonly additions: number;
  readonly deletions: number;
}

/**
 * A validated GitHub review-comment anchor. Produced by the anchor mapper in
 * @gigadrive/lupe-git after confirming the target line is part of the diff
 * (avoids the 422 "line must be part of the diff" error).
 */
export interface Anchor {
  readonly path: string;
  /** The (inclusive) end line the comment is anchored to. */
  readonly line: number;
  readonly side: Side;
  /** For multi-line comments, the start of the range. */
  readonly startLine?: number;
  readonly startSide?: Side;
}

/** Convenience: every (side, lineNumber) pair that is actually part of a file's diff. */
export interface CommentableLine {
  readonly line: number;
  readonly side: Side;
}
