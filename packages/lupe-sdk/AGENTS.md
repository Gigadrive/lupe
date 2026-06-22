# AGENTS.md — `@gigadrive/lupe-sdk`

The embeddable, **Promise-returning** facade so other products run lupe without learning Effect.

## Owns

- `reviewDiff(opts)` and `reviewPullRequest(opts)` (`src/index.ts`) — build the layers, run the Effect program internally via `Effect.runPromise`, return typed `Finding[]` + summary + cost + a `sarif()` renderer.
- Re-exports the stable public types (`Finding`, `LupeAiConfig`, `SarifLog`, `ReviewProfile`) from core.

## Depends on

- `@gigadrive/lupe-core`, `@gigadrive/lupe-git`, `@gigadrive/lupe-github`, and `effect` (a regular dep here — the SDK bundles the runtime so consumers don't need Effect).

## Rules

- Keep the surface **Promise-based and Effect-free** for consumers. Do not leak `Effect`/`Layer` types in the public API.
- Short-circuit before any model call when there are no reviewable files (so empty-diff usage is offline + free).
- This is the package external apps embed — treat its types as a stable contract; additive changes only.
