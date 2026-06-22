import type { DiffFile, DiffHunk } from "../diff";

/** Serialise diffs into the model prompt, preserving head line numbers so the
 * model can cite exact lines for anchoring. */

function serialiseHunk(hunk: DiffHunk): string {
  const head = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${
    hunk.section ? " " + hunk.section : ""
  }`;
  const body = hunk.lines
    .map((l) => {
      const marker = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
      const lineNo = l.newLine ?? l.oldLine;
      const num = lineNo !== undefined ? `${String(lineNo).padStart(5)} ` : "";
      return `${marker}${num}${l.content}`;
    })
    .join("\n");
  return `${head}\n${body}`;
}

/** Serialise one file's diff with a header and head line numbers. */
export function serialiseFileDiff(file: DiffFile): string {
  const renamed = file.oldPath ? ` (renamed from ${file.oldPath})` : "";
  const header = `### ${file.path}${renamed} [${file.status}]`;
  if (file.binary) return `${header}\n(binary file — skipped)`;
  return `${header}\n${file.hunks.map(serialiseHunk).join("\n")}`;
}

/** Serialise the whole review-ready file set into one prompt block. */
export function renderDiffPrompt(files: readonly DiffFile[]): string {
  return files.map(serialiseFileDiff).join("\n\n");
}
