# AGENTS.md — `@gigadrive/lupe-github`

GitHub transport adapter behind core's `GitHubClient` port. No AI SDK.

## Owns

- The Octokit client (`src/octokit.ts`) with `plugin-retry` + `plugin-throttling`. Type the instance as the base `Octokit` (plugin-augmented types aren't portably nameable).
- `GitHubClientLive` (`src/client.ts`): paginated `pulls.listFiles` → `DiffFile[]`; **one** batched `pulls.createReview` (path+line+side, never deprecated `position`); upsert one `<!-- lupe-summary -->` sticky comment (stores last-reviewed SHA); resolve stale lupe threads via GraphQL `resolveReviewThread`.
- `anchorFindings` (`src/anchor-findings.ts`): resolve findings → anchored comments (+ `renderInlineComment`), routing unanchorable ones to the summary.

## Depends on

- `@gigadrive/lupe-core` (`GitHubClient` port, `Finding`, markers) and `@gigadrive/lupe-git` (`buildDiffFile`, `resolveAnchor`).

## Rules

- Batch ALL findings into a single `createReview` (stays under GitHub's secondary rate limits). Never post N comments separately.
- Lift Octokit failures into the tagged `GitHubError` at this boundary.
- The sticky-comment marker (`SUMMARY_MARKER`) and inline marker (`INLINE_MARKER`) come from `lupe-core`; don't hardcode duplicates.
