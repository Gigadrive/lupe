# AGENTS.md — `@gigadrive/lupe-core`

The review engine. Imported by the SDK, CLI, and Action. **IO-light**: no Octokit, no `node:child_process`, no network except through the AI SDK at one seam.

## Owns

- The `Finding` model (Zod 4, `src/finding.ts`) — single source of truth for findings + tool/output schemas.
- The provider registry + task routing (`src/ai/provider.ts`): `triage`/`review`/`verify`/`deep` → model ids.
- The `AiModel` service tag + its AI SDK `Layer` (`src/ai/{model.ts,ai-sdk-layer.ts}`) — the hand-rolled `generateText` tool loop, `Output.array`, prompt-cache placement, usage→cost (`pricing.ts`).
- The pipeline (`src/review/{engine,verify,filter,pipeline}.ts`): generate → grounding verifier → dedup/confidence/category/learnings filter chain.
- Renderers (`src/render/{sarif,markdown,diff-prompt}.ts`) and tagged errors (`src/errors.ts`).
- The ports it depends on: `RepoSource`, `GitHubClient` (`src/ports.ts`) — interfaces only.

## Does not own

- GitHub API calls (→ `lupe-github`), diff parsing/anchoring/compression (→ `lupe-git`), process spawning (→ `apps/cli`).
- No internal `@gigadrive/*` dependencies — core is the base of the graph.

## Rules

- Keep the AI SDK confined to `src/ai/`. Everything else depends on the `AiModel` tag.
- `Finding` (Zod) is the only schema at the AI boundary. Effect Schema may be used elsewhere, never for model output.
- Generation is **recall-biased**; publication is gated by the verifier + filter chain. Don't add findings that bypass them.
- New provider = one `case` in `buildProvider` + a `pricing.ts` row + (if Anthropic-like) cache-breakpoint handling.
- Use `output: Output.array` + `stopWhen: [stepCountIs(N)]`. Never `generateObject`/`streamObject` (deprecated in v6).
