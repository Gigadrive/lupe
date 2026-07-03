# @gigadrive/lupe-github

## 0.1.0

### Minor Changes

- d5f5c13: Initial release of **lupe** — a platform- and provider-agnostic, BYO-token AI code review agent.

  - `@gigadrive/lupe-core` — the review engine: Finding model, provider registry, hand-rolled agent loop, grounding verifier, filter chain, SARIF + markdown renderers.
  - `@gigadrive/lupe-git` — diff parsing, hunk → (line, side) anchoring, read-only repo tools, Qodo-style context compression.
  - `@gigadrive/lupe-github` — GitHub transport: paginated diff fetch, one batched review, sticky summary with incremental state, thread resolution.
  - `@gigadrive/lupe` — the CLI (`lupe`): `review`, `explain`, `check`, `init`, `learn`. BYO API keys or opt-in local Claude Code / Codex credentials.
  - `@gigadrive/lupe-sdk` — embeddable `reviewDiff` / `reviewPullRequest` Promise API.

### Patch Changes

- Updated dependencies [d5f5c13]
  - @gigadrive/lupe-core@0.1.0
  - @gigadrive/lupe-git@0.1.0
