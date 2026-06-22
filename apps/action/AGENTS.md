# AGENTS.md — `@gigadrive/lupe-action`

The reusable GitHub Action. Private (consumed via git ref, not npm).

## Owns

- `action.yml` (`runs.using: node24`) + the entry (`src/index.ts`): thin `@actions/core` + `@actions/github` glue that reads inputs/PR context, builds the Effect runtime, provides the layers, runs `runReview`, anchors findings, and posts one review + sticky summary.
- The committed **`dist/` bundle** (ncc), referenced by `action.yml`.

## Depends on

- `@gigadrive/lupe-core`, `@gigadrive/lupe-git`, `@gigadrive/lupe-github`; `@actions/core`, `@actions/github`, `effect`. (Builds with `effect` only — no `@effect/platform*`; it uses `Effect.runPromise`, not `runMain`.)

## Rules

- **`dist/` is committed and CI-verified.** After ANY change to this app or its dep graph, run `pnpm turbo run build --filter=@gigadrive/lupe-action` and commit `apps/action/dist`, or the `action-dist` CI job fails. `.gitattributes` forces LF so the bundle doesn't drift on line endings.
- Build via **turbo** (so workspace deps build first), not `pnpm --filter … run build` in isolation.
- Trigger on `pull_request` only. **Never** `pull_request_target` with an untrusted checkout (RCE/secret-exfil). The only required secret is the provider key; GitHub access uses the built-in `GITHUB_TOKEN` with `pull-requests: write`.
- Don't add analysis logic here — it's ingest + transport glue around the shared core.
