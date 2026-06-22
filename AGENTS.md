# AGENTS: working on lupe with AI agents

This document is for AI agents and LLMs (Claude Code, Codex, Cursor, …) contributing to **lupe** — an open-source, BYO-token, platform- and provider-agnostic AI code review agent (an alternative to CodeRabbit / Cursor Bugbot / Greptile that runs on the user's own model tokens).

Follow these rules to avoid breaking the monorepo, use the right tools, and produce maintainable code. Per-package `AGENTS.md` files add local rules — read the one for the package you're editing.

## The one rule that explains the architecture

> **Model-touching code uses the Vercel AI SDK. App wiring uses Effect.**

- **Vercel AI SDK 6 (`ai@^6`)** is the AI engine: model resolution, the hand-rolled `generateText` tool loop, `Output.array` structured findings, prompt caching, usage/cost accounting.
- **Effect (v3)** is the application backbone _only_: dependency injection (`Layer`/`Context.Tag`), typed errors (`Data.TaggedError`), `Config`, `@effect/cli`, bounded concurrency, retry, resource lifetimes.
- Every AI SDK / Octokit / subprocess Promise is wrapped in `Effect.tryPromise` at **exactly one seam per concern**.
- `@effect/ai` is **NOT** used (it's alpha). The Effect `AiModel` service tag in `lupe-core` is the migration seam; the v1 concrete `Layer` (`AiSdkLive`) wraps the AI SDK. Adopting `@effect/ai` later is a localized `Layer` swap — do not reach for it now.

## Monorepo at a glance

- **Package manager**: pnpm (strictly required; never npm/yarn). Versions are pinned **exactly** in the `pnpm-workspace.yaml` **catalog** — reference them with `catalog:`.
- **Orchestrator**: Turborepo (`turbo.json`).
- **Build**: `tsdown` (ESM-only). Output is `dist/index.mjs` + `dist/index.d.mts` — `exports`/`bin` point at `.mjs`/`.d.mts`.
- **Format**: `oxfmt` (single-quote, 120-col, import sorting). **Lint**: `oxlint`. **Dep hygiene**: `knip`. **Effect checks**: `@effect/language-service` (`pnpm effect:check`). _Not_ Prettier/ESLint.
- **Tests**: `vitest`. **Releases**: Changesets. **Node**: ≥ 20.18 (the Action runs on `node24`).

### Packages (`@gigadrive/*`)

| Path                         | Package                             | Role                                                                                                                                                                                                                                       |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/lupe-core`         | `@gigadrive/lupe-core`              | The review engine. Imported by everything. Owns the `Finding` model, provider registry, agent loop, grounding verifier, filter chain, renderers, and the `AiModel`/`RepoSource`/`GitHubClient` ports. **No Octokit, no process-spawning.** |
| `packages/lupe-git`          | `@gigadrive/lupe-git`               | Diff parsing, hunk → `(line, side)` anchoring (the 422 guard), context compression, and the local `RepoSource` (simple-git).                                                                                                               |
| `packages/lupe-github`       | `@gigadrive/lupe-github`            | GitHub transport: paginated diff fetch, one batched review, sticky summary, thread resolution.                                                                                                                                             |
| `apps/cli`                   | `@gigadrive/lupe`                   | The CLI (`lupe`): `review`/`explain`/`check`/`init`/`learn`. Owns the opt-in `claude-cli`/`codex-cli` local backends.                                                                                                                      |
| `apps/action`                | `@gigadrive/lupe-action`            | The reusable GitHub Action (node24, ncc-bundled). Private (consumed via git ref).                                                                                                                                                          |
| `packages/lupe-sdk`          | `@gigadrive/lupe-sdk`               | Embeddable Promise facade: `reviewDiff` / `reviewPullRequest`.                                                                                                                                                                             |
| `packages/eval`              | `@repo/eval` (private)              | Eval harness: precision/recall metrics, SARIF-validity gate, gated live prompt-cache test.                                                                                                                                                 |
| `packages/typescript-config` | `@repo/typescript-config` (private) | Shared `base.json` / `library.json`.                                                                                                                                                                                                       |

**Dependency direction (do not violate):** `lupe-core` depends on nothing internal. `lupe-git` → core. `lupe-github` → core + git. `lupe-sdk`/`cli`/`action` → core + git + github. Core defines the ports; git/github/cli implement them.

### The review pipeline (8 stages)

`ingest → diff acquisition → context assembly → generation (agent loop) → grounding verifier → filter chain → anchoring/output → learnings`. Stages 3–6 + 8 are the shared, tested core (in `lupe-core`). **The CLI and Action differ only in stage 1 (ingest) and stage 7 (transport).**

## Golden rules (read first)

- **Never commit or push unless explicitly asked.** Complete the work and let the user decide.
- **Conventional Commits** for messages when a commit is requested (e.g. `fix(core): guard empty diff`). End commit bodies with the `Co-Authored-By` trailer.
- **Never amend or force-push.** Always new commits.
- **pnpm only.** Never generate npm/yarn lockfiles. Use `pnpm dlx` for one-off CLIs.
- **Respect the AI-SDK-vs-Effect seam** (top of this file). Do not call the AI SDK from outside `lupe-core/src/ai/`. Do not import Octokit outside `lupe-github`. Do not spawn processes outside the CLI's `local-providers.ts`.
- **`Finding` (Zod 4, `lupe-core/src/finding.ts`) is the single source of truth** for findings + tool/output schemas. Don't define parallel finding shapes. Effect Schema stays on the config/domain side, never at the AI boundary.
- **Rebuild the Action bundle when its source/deps change.** `apps/action/dist` is committed and verified in CI. Run `pnpm turbo run build --filter=@gigadrive/lupe-action` and commit `dist`, or the `action-dist` CI job fails.
- **Use `pnpm` task names, not raw tools**, so Turbo ordering/caching applies.

## Commands agents should run (pnpm only)

```bash
pnpm install                       # install (frozen in CI)
pnpm build                         # turbo run build (tsdown, ESM-only)
pnpm typecheck                     # turbo run typecheck (tsc, no emit)
pnpm test                          # turbo run test (vitest)
pnpm check:exports                 # publint on each publishable package
pnpm format        # oxfmt --check  ·  pnpm format:fix to apply
pnpm lint          # oxlint         ·  pnpm lint:fix to apply
pnpm knip                          # unused deps / exports / files
pnpm effect:check                  # @effect/language-service diagnostics

pnpm --filter @gigadrive/lupe-core test          # one package
pnpm turbo run build --filter=@gigadrive/lupe-action   # rebuild + (re)commit the Action bundle

node apps/cli/dist/index.mjs review -C <repo> --print   # run the CLI (bin not globally linked)
ANTHROPIC_API_KEY=… node apps/cli/dist/index.mjs check
```

Before declaring work done, run the CI equivalents locally: `pnpm format && pnpm lint && pnpm knip` and `pnpm turbo run build typecheck test check:exports && pnpm effect:check`.

## Conventions & deliberate deviations (do not "fix" these)

- **ESM-only**, `"type": "module"`, `sideEffects: false`. `tsdown` emits `.mjs`/`.d.mts`.
- **`isolatedDeclarations` is intentionally OFF** — Effect's inferred types make hand-written return types impractical; tsdown generates `.d.ts` normally.
- **Catalog pins are exact** (no `^`/`~`) for runtime deps. Keep the **effect quartet** (`effect` + `@effect/platform` + `@effect/platform-node` + `@effect/cli`) and the **AI SDK set** (`ai` + `@ai-sdk/*`) moving together — Renovate groups them.
- **Review generation uses `output: Output.array({ element: Finding })` + `stopWhen: [stepCountIs(N)]`** (no `submitFindings` terminal tool). `generateObject`/`streamObject` are deprecated in v6 — don't use them.
- **Anthropic prompt cache**: the frozen system prefix carries `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`; keep it ≥ the per-model minimum (4096 for Opus 4.8 / Haiku 4.5). Don't switch models mid-chunk (caches are model-scoped).
- **Local-credential backends** (`claude-cli`/`codex-cli`) are strictly opt-in, spawn the user's _own_ authenticated binary, print a ToS notice, and **never read/forward a token**. Keep it that way.
- **Tagged errors only** (`Data.TaggedError` in `lupe-core/src/errors.ts`) — never throw opaque errors across a seam. Adapters lift raw failures into a tagged error at the boundary.

## Effect guidelines

- Services via `Context.Tag` + `Layer`; the engine depends on **tags**, not concretions (`AiModel`, `RepoSource`, `GitHubClient`).
- Wrap Promise libraries with `Effect.tryPromise({ try, catch })`, mapping `catch` to a tagged error. Use `Effect.gen` for sequential flows, `Effect.forEach(..., { concurrency })` for bounded fan-out.
- `@effect/cli` commands ARE Effects; provide app layers via `Effect.provide` + `NodeRuntime.runMain`.
- Run `pnpm effect:check` — it catches Effect-specific issues (missing layer deps, floating effects).

## Do / Don't quick reference

- **Do** keep `lupe-core` free of Octokit and `node:child_process`.
- **Do** add a new provider in `lupe-core/src/ai/provider.ts` (one `case` in `buildProvider`) + a pricing row in `pricing.ts`.
- **Do** add tests next to the code (`*.test.ts`); offline by default. Network/model tests must be gated (`test.skipIf(!process.env.ANTHROPIC_API_KEY)`).
- **Don't** introduce Prettier/ESLint, add `^`-ranged runtime deps, or commit a stale `apps/action/dist`.
- **Don't** import a workspace package's internals — use its public `exports`.
- **Don't** bypass the grounding verifier / filter chain when adding findings; bias generation for recall and let the pipeline gate publication.

## Useful paths

- Engine seam: `packages/lupe-core/src/ai/{model.ts,provider.ts,ai-sdk-layer.ts}`
- Finding model: `packages/lupe-core/src/finding.ts`
- Pipeline: `packages/lupe-core/src/review/{engine,verify,filter,pipeline}.ts`
- 422 anchor guard: `packages/lupe-git/src/anchor.ts`
- GitHub transport: `packages/lupe-github/src/client.ts`
- CLI entry: `apps/cli/src/index.ts`
- Action entry: `apps/action/src/index.ts`
- Config: `.lupe.yaml` (parsed in `apps/cli/src/config.ts`)
