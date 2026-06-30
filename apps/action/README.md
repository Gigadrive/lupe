# lupe GitHub Action

Drop-in AI code review on your pull requests. Bring your own model token.

## Usage

```yaml
# .github/workflows/lupe.yml
name: lupe
on:
  pull_request:

permissions:
  contents: read # read the repo
  pull-requests: write # post the review + summary

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history helps incremental re-reviews
      - uses: gigadrive/lupe/apps/action@v1
        with:
          provider: anthropic
          profile: chill
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

The only required secret is your **provider key** (e.g. `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `AI_GATEWAY_API_KEY`). GitHub
access uses the built-in `GITHUB_TOKEN`.

> **Versioning.** The `@vN` ref points at a release tag whose tree contains the
> built bundle — the bundle is built and tagged by the release workflow, not
> committed to `main`. Pin to a moving major (`@v1`) or an immutable
> `@vX.Y.Z`. While the action is pre-1.0 the major alias is `@v0`.

## Inputs

| Input              | Default               | Description                                                                          |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------ |
| `provider`         | `anthropic`           | `anthropic` \| `openai` \| `google` \| `bedrock` \| `openai-compatible` \| `gateway` |
| `models`           | —                     | JSON map of task→model id, e.g. `{"review":"claude-opus-4-8"}`                       |
| `profile`          | `chill`               | `chill` (high-confidence only) or `assertive`                                        |
| `base-url`         | —                     | Custom endpoint for `openai-compatible` / `gateway`                                  |
| `max-files`        | —                     | Cap the number of changed files reviewed                                             |
| `max-findings`     | —                     | Cap the number of findings posted                                                    |
| `thorough`         | `false`               | Use the strongest model + extra passes                                               |
| `skip-draft`       | `true`                | Skip draft PRs                                                                       |
| `fail-on-severity` | `none`                | Fail the job at/above `critical`\|`high`\|`medium`\|`low`                            |
| `github-token`     | `${{ github.token }}` | Token used to read the PR and post comments                                          |

## Outputs

| Output     | Description                        |
| ---------- | ---------------------------------- |
| `findings` | Number of findings posted          |
| `cost-usd` | Approximate USD cost of the review |

## Security

Trigger on **`pull_request`**, not `pull_request_target` — running with a
writable token against an untrusted fork checkout is the documented
RCE/secret-exfiltration vector. lupe posts a single batched review plus one
sticky `<!-- lupe-summary -->` comment, and re-reviews incrementally from the
last reviewed SHA stored in that comment.
