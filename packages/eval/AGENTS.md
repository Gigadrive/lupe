# AGENTS.md — `@repo/eval` (private)

The evaluation harness. Not published. Proves the operating point and guards regressions.

## Owns

- Metrics (`src/metrics.ts`): precision/recall/F1 and the actionable-comments noise budget.
- The **SARIF 2.1.0 validity gate** (`src/sarif-validity.test.ts`) — structural assertions GitHub code scanning requires.
- The **gated live prompt-cache test** (`src/prompt-cache.live.test.ts`): asserts `usage.cacheReadTokens > 0` on a second identical Anthropic call. Runs only when `ANTHROPIC_API_KEY` is set.

## Depends on

- `@gigadrive/lupe-core`, `@gigadrive/lupe-git`, `effect`, `vitest`.

## Rules

- Any test that hits a real model/network must be `test.skipIf(!process.env.ANTHROPIC_API_KEY)` — CI without a key must stay green.
- This package exists to make the precision/recall + noise-budget discipline measurable; grow it with labeled cases rather than moving that logic into product packages.
