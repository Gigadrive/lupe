import type { DiffFile, DiffHunk, DiffLine, DiffStatus } from "@gigadrive/lupe-core";

/**
 * Unified-diff parser. Handles both a full multi-file `git diff` and a single
 * file's hunk-only `patch` (as returned by GitHub's `pulls.listFiles`).
 */

interface MutableHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  section?: string;
  lines: DiffLine[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/** Parse the `@@` hunks of a single patch body. */
export function parseHunks(patch: string): DiffHunk[] {
  const hunks: MutableHunk[] = [];
  let current: MutableHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] ? Number(header[2]) : 1,
        newStart: Number(header[3]),
        newLines: header[4] ? Number(header[4]) : 1,
        section: header[5]?.trim() ? header[5].trim() : undefined,
        lines: [],
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }
    if (!current) continue; // preamble before the first hunk
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"

    const marker = raw.charAt(0);
    const content = raw.slice(1);
    if (marker === "+") {
      current.lines.push({ kind: "add", content, newLine });
      newLine++;
    } else if (marker === "-") {
      current.lines.push({ kind: "del", content, oldLine });
      oldLine++;
    } else if (marker === " ") {
      current.lines.push({ kind: "context", content, oldLine, newLine });
      oldLine++;
      newLine++;
    }
    // any other line (empty trailing split, metadata) is ignored
  }

  return hunks.map((h) => ({ ...h, lines: h.lines }));
}

function countLines(hunks: readonly DiffHunk[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.kind === "add") additions++;
      else if (l.kind === "del") deletions++;
    }
  }
  return { additions, deletions };
}

const GITHUB_STATUS: Record<string, DiffStatus> = {
  added: "added",
  removed: "deleted",
  modified: "modified",
  renamed: "renamed",
  changed: "modified",
  copied: "added",
};

/** Build a DiffFile from a GitHub `pulls.listFiles` entry (hunk-only patch). */
export function buildDiffFile(input: {
  readonly filename: string;
  readonly previousFilename?: string;
  readonly status: string;
  readonly patch?: string;
}): DiffFile {
  const hunks = input.patch ? parseHunks(input.patch) : [];
  const { additions, deletions } = countLines(hunks);
  const status = GITHUB_STATUS[input.status] ?? "modified";
  return {
    path: input.filename,
    oldPath: input.previousFilename,
    status,
    binary: !input.patch && input.status !== "renamed",
    hunks,
    additions,
    deletions,
  };
}

function stripPrefix(p: string): string {
  if (p === "/dev/null") return p;
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2);
  return p;
}

/** Parse a full, possibly multi-file unified diff (`git diff` output). */
export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diffText.split("\n");

  // Split into per-file sections delimited by "diff --git ".
  const sections: string[][] = [];
  let currentSection: string[] | undefined;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentSection = [line];
      sections.push(currentSection);
    } else if (currentSection) {
      currentSection.push(line);
    }
  }

  for (const section of sections) {
    const text = section.join("\n");
    let oldPath: string | undefined;
    let newPath: string | undefined;
    let status: DiffStatus = "modified";
    let binary = false;

    for (const line of section) {
      if (line.startsWith("new file mode")) status = "added";
      else if (line.startsWith("deleted file mode")) status = "deleted";
      else if (line.startsWith("rename from ")) {
        status = "renamed";
        oldPath = line.slice("rename from ".length).trim();
      } else if (line.startsWith("rename to ")) {
        status = "renamed";
        newPath = line.slice("rename to ".length).trim();
      } else if (line.startsWith("--- ")) {
        const p = stripPrefix(line.slice(4).trim());
        if (p !== "/dev/null") oldPath = p;
        else status = "added";
      } else if (line.startsWith("+++ ")) {
        const p = stripPrefix(line.slice(4).trim());
        if (p !== "/dev/null") newPath = p;
        else status = "deleted";
      } else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
        binary = true;
      }
    }

    // Fall back to the `diff --git a/x b/y` header for paths when needed.
    if (!oldPath || !newPath) {
      const header = /^diff --git a\/(.+) b\/(.+)$/.exec(section[0] ?? "");
      if (header) {
        oldPath = oldPath ?? header[1];
        newPath = newPath ?? header[2];
      }
    }

    const path = status === "deleted" ? (oldPath ?? newPath ?? "") : (newPath ?? oldPath ?? "");
    const hunks = binary ? [] : parseHunks(text);
    const { additions, deletions } = countLines(hunks);

    files.push({
      path,
      oldPath: oldPath && oldPath !== path ? oldPath : undefined,
      status,
      binary,
      hunks,
      additions,
      deletions,
    });
  }

  return files;
}
