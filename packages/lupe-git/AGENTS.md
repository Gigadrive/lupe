# AGENTS.md — `@gigadrive/lupe-git`

Diff + repo-context primitives. Pure and node-only; no GitHub API, no LLM calls.

## Owns

- Unified-diff parser (`src/parse.ts`) — handles full `git diff` and GitHub hunk-only patches (`buildDiffFile`).
- **Hunk → `(line, side)` anchor mapper (`src/anchor.ts`) — the 422 guard.** `resolveAnchor`/`toAnchor` map a finding to a commentable line or report it as unanchorable. This is where GitHub's "line must be part of the diff" (HTTP 422) is prevented; keep its tests exhaustive.
- Qodo-style compression (`src/compress.ts`): drop binary/generated/lockfiles, path filters, rank, token budget.
- `RepoSource` implementation (`src/repo-source.ts`) over `simple-git` + `node:fs` (the agent's read-only tools + local diff acquisition).

## Depends on

- `@gigadrive/lupe-core` (the `DiffFile`/`Anchor`/`Finding` types, `RepoSource` tag, tagged errors). Re-exports core's `serialiseFileDiff`/`renderDiffPrompt`.

## Rules

- Diff/anchor logic lives **here**, not in `lupe-github` (transport) or `lupe-core` (AI). The anchor mapper is the only thing that decides commentability.
- Keep it deterministic and offline-testable. The real-git integration test uses a temp repo.
- `convention`: additions/context are commentable on `RIGHT` (head line numbers), deletions on `LEFT` (base line numbers).
