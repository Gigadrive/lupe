import { Octokit } from "@octokit/rest";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";

/** Octokit with automatic retry + primary/secondary rate-limit throttling. */
const OctokitWithPlugins = Octokit.plugin(retry, throttling);

/** The base Octokit type already exposes `.rest`, `.paginate`, and `.graphql`,
 * which is all we use — annotate with it to keep the type portable. */
export type LupeOctokit = Octokit;

export interface OctokitConfig {
  readonly token: string;
  readonly baseUrl?: string;
  readonly userAgent?: string;
}

export function createOctokit(config: OctokitConfig): LupeOctokit {
  return new OctokitWithPlugins({
    auth: config.token,
    baseUrl: config.baseUrl,
    userAgent: config.userAgent ?? "lupe",
    throttle: {
      onRateLimit: (_retryAfter: number, _options: unknown, _octokit: unknown, retryCount: number) =>
        retryCount < 3,
      onSecondaryRateLimit: (_retryAfter: number, _options: unknown, _octokit: unknown, retryCount: number) =>
        retryCount < 3,
    },
  });
}
