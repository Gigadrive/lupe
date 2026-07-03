# @gigadrive/lupe-core

## 0.2.0

### Minor Changes

- d5f5c13: Production-readiness release: docs site + cost-aware, safer PR reviews.

  - **Cost controls** — pre-flight cost estimate + a hard `max-cost-usd` / `maxCostUsd` cap (Action input, CLI flag, SDK option) that fails the run before/mid the model calls; corrected + per-deployment-overridable model pricing (`modelPrices`).
  - **Cumulative incremental reviews** — the sticky summary now carries forward findings on files not touched by a re-review, and stale-thread resolution is scoped to the files reviewed this run (findings on untouched files survive). Cross-run dedupe stops force-push re-reviews from re-posting findings.
  - **Incremental-diff fix** — `listDiffSince` now paginates instead of silently seeing only the first 100 changed files, falling back to the full diff past the compare limit.
  - **Security** — the Action refuses to run on `pull_request_target` unless explicitly opted in (and then runs tool-less), and likely secrets are redacted from the diff before it reaches the model.
