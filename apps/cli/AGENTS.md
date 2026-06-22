# AGENTS.md — `@gigadrive/lupe` (CLI)

The published CLI (`bin: lupe`), built on `@effect/cli`. Commands ARE Effects.

## Owns

- The command tree (`src/index.ts`): `review`, `explain`, `check`, `init`, `learn`. Wired via `NodeContext.layer` + `NodeRuntime.runMain`; app layers (`AiSdkLive`/local backend + `RepoSourceLive`) provided per-run.
- **Local-credential backends** (`src/local-providers.ts`): `claude-cli` (`claude -p`) and `codex-cli` (`codex exec`) as extra `AiModel` Layers — spawn the user's own authenticated binary, print a one-time ToS notice, parse JSON out of stdout, **never touch tokens**.
- Config loading (`src/config.ts`, `.lupe.yaml` via `yaml` / `lupe.config.*` via c12), terminal rendering (`src/render.ts`, ANSI — no chalk dep), and the file-based learnings store (`src/learnings.ts`).

## Depends on

- `@gigadrive/lupe-core`, `@gigadrive/lupe-git`; `@effect/cli` + `@effect/platform[-node]`, `@clack/prompts`, `c12`, `yaml`. (Does **not** import `lupe-github` — local CLI review is print-only; PR posting goes through the Action/SDK.)

## Rules

- Local backends are **opt-in** (`--provider claude-cli|codex-cli`), default strongly to API keys, and stay token-free. Don't run `setup-token` or capture `CLAUDE_CODE_OAUTH_TOKEN`. Warn on a stray `ANTHROPIC_API_KEY` that would override a subscription.
- The CLI provider enum = API providers (`ApiProviderId`) **plus** `claude-cli`/`codex-cli` (`CliProvider` in `config.ts`).
- Printing is the default; `--format md|sarif|json`. Map tagged errors to clean messages + nonzero exit in the top-level `catchTags`.
- The `lupe` bin isn't globally linked in dev — run `node apps/cli/dist/index.mjs` (or `npm link`).
