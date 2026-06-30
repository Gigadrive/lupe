# AGENTS.md — `@gigadrive/lupe-action`

The reusable GitHub Action. Private (consumed via git ref, not npm).

## Owns

- `action.yml` (`runs.using: node24`) + the entry (`src/index.ts`): thin `@actions/core` + `@actions/github` glue that reads inputs/PR context, builds the Effect runtime, provides the layers, runs `runReview`, anchors findings, and posts one review + sticky summary.
- The **`dist/` bundle** (ncc), referenced by `action.yml`. It is gitignored on `main` and built + tagged at release time (see Rules).

## Depends on

- `@gigadrive/lupe-core`, `@gigadrive/lupe-git`, `@gigadrive/lupe-github`; `@actions/core`, `@actions/github`, `effect`. (Builds with `effect` only — no `@effect/platform*`; it uses `Effect.runPromise`, not `runMain`.)

## Rules

- **`dist/` is NOT committed — it's gitignored.** GitHub runs the action from the consumed git ref, so the bundle must exist on that ref but not on `main`. The bundle is built and tagged only at release: when Changesets bumps `@gigadrive/lupe-action`, `release.yml` builds it and force-pushes the immutable `vX.Y.Z` tag plus the moving `vN` alias (the tree at those tags includes `apps/action/dist`; `main` never does). Consumers reference `gigadrive/lupe/apps/action@vN`. Because the bundle embeds `lupe-core`/`-git`/`-github`, `updateInternalDependents: "always"` makes a core change republish the action. Build locally with `pnpm turbo run build --filter=@gigadrive/lupe-action`.
- Build via **turbo** (so workspace deps build first), not `pnpm --filter … run build` in isolation.
- Trigger on `pull_request` only. **Never** `pull_request_target` with an untrusted checkout (RCE/secret-exfil). The only required secret is the provider key; GitHub access uses the built-in `GITHUB_TOKEN` with `pull-requests: write`.
- Don't add analysis logic here — it's ingest + transport glue around the shared core.
