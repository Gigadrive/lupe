import type { DiffFile, DiffHunk, DiffLine } from '@gigadrive/lupe-core';

/**
 * Best-effort secret/PII redaction applied to diff line content BEFORE it is
 * serialised into the model prompt. Pure and conservative: it targets
 * high-confidence credential shapes (provider tokens, JWTs, PEM keys) plus
 * secret-looking assignment values, replacing the value with a `«redacted:kind»`
 * marker. It never changes line numbers or which lines are part of the diff, so
 * anchoring is unaffected.
 */

const AWS_ACCESS_KEY = /\bAKIA[0-9A-Z]{16}\b/g;
const GITHUB_TOKEN = /\bgh[pousr]_[0-9A-Za-z]{20,}\b/g;
const SLACK_TOKEN = /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g;
const PEM_PRIVATE_KEY = /-----BEGIN[A-Z ]*PRIVATE KEY-----/g;
// `secret = "aB3d...":` style — only redact a long, digit-bearing value so we
// don't blank out ordinary code like `token = getToken()`.
const SECRET_ASSIGNMENT =
  /\b(password|passwd|secret|token|api[_-]?key|access[_-]?token|client[_-]?secret)\b(\s*[:=]\s*)(['"]?)([A-Za-z0-9+/_=.-]{12,})(\3)/gi;

/** Redact secrets in a single line of content. Pure. */
export function redactLine(content: string): string {
  let out = content
    .replace(AWS_ACCESS_KEY, '«redacted:aws-access-key»')
    .replace(GITHUB_TOKEN, '«redacted:github-token»')
    .replace(SLACK_TOKEN, '«redacted:slack-token»')
    .replace(JWT, '«redacted:jwt»')
    .replace(PEM_PRIVATE_KEY, '«redacted:private-key»');
  out = out.replace(SECRET_ASSIGNMENT, (m, key: string, sep: string, q: string, val: string, qEnd: string) =>
    /\d/.test(val) ? `${key}${sep}${q}«redacted:secret»${qEnd}` : m
  );
  return out;
}

export interface RedactionResult {
  readonly files: readonly DiffFile[];
  /** Number of diff lines whose content was altered. */
  readonly redactions: number;
}

/** Redact likely secrets across a set of diff files, returning new files + a count. */
export function redactSecrets(files: readonly DiffFile[]): RedactionResult {
  let redactions = 0;
  const out = files.map((file) => {
    if (file.binary || file.hunks.length === 0) return file;
    let changed = false;
    const hunks: DiffHunk[] = file.hunks.map((hunk) => {
      const lines: DiffLine[] = hunk.lines.map((line) => {
        const redacted = redactLine(line.content);
        if (redacted === line.content) return line;
        redactions++;
        changed = true;
        return { ...line, content: redacted };
      });
      return { ...hunk, lines };
    });
    return changed ? { ...file, hunks } : file;
  });
  return { files: out, redactions };
}
