#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as nodePath from 'node:path';

import * as clack from '@clack/prompts';
import { Args, Command, Options } from '@effect/cli';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { Console, Effect, Layer, Option } from 'effect';
import { stringify as stringifyYaml } from 'yaml';

import {
  AiSdkLive,
  ConfigError,
  RepoSource,
  generateDescription,
  renderDescription,
  renderSarif,
  runReview,
  type ReviewProfile,
  type ReviewRunResult,
  type ReviewTarget,
} from '@gigadrive/lupe-core';
import { RepoSourceLive, compressDiff, discoverCodingStandards } from '@gigadrive/lupe-git';

import { loadFileConfig, providerKeyEnv, type CliProvider } from './config';
import { addLearning, loadLearnings } from './learnings';
import { ClaudeCliLive, CodexCliLive, LOCAL_PROVIDERS, isLocalProvider } from './local-providers';
import { colors, formatReview } from './render';

const VERSION = '0.0.0';

const API_PROVIDERS = ['anthropic', 'openai', 'google', 'bedrock', 'openai-compatible', 'gateway'] as const;
const PROVIDERS = [...API_PROVIDERS, ...LOCAL_PROVIDERS] as const;

const opt = <A>(o: Option.Option<A>): A | undefined => Option.getOrUndefined(o);

// ---------------------------------------------------------------------------
// Shared review flow (used by `review` and `explain`)
// ---------------------------------------------------------------------------

interface ReviewFlags {
  readonly cwd: string;
  readonly base?: string;
  readonly head?: string;
  readonly provider?: CliProvider;
  readonly profile?: ReviewProfile;
  readonly format: 'md' | 'sarif' | 'json';
  readonly maxFiles?: number;
  readonly maxFindings?: number;
  readonly thorough: boolean;
  readonly verify: boolean;
  readonly onlyPath?: string;
}

function emit(result: ReviewRunResult, format: ReviewFlags['format']): Effect.Effect<void> {
  if (format === 'sarif') {
    return Console.log(JSON.stringify(renderSarif(result.findings, { version: VERSION }), null, 2));
  }
  if (format === 'json') {
    return Console.log(JSON.stringify(result.findings, null, 2));
  }
  return Console.log(formatReview(result));
}

function runReviewFlow(flags: ReviewFlags) {
  return Effect.gen(function* () {
    const fileConfig = yield* loadFileConfig(flags.cwd);
    const learnings = yield* loadLearnings(flags.cwd);
    const codingStandards = discoverCodingStandards({ rootDir: flags.cwd, explicit: fileConfig.codingStandards });
    const provider: CliProvider = flags.provider ?? fileConfig.provider ?? 'anthropic';
    const target: ReviewTarget = { kind: 'local', baseRef: flags.base, headRef: flags.head };

    const aiLayer = isLocalProvider(provider)
      ? provider === 'claude-cli'
        ? ClaudeCliLive()
        : CodexCliLive()
      : AiSdkLive({ provider, models: fileConfig.models, baseURL: fileConfig.baseURL });
    const layer = aiLayer.pipe(Layer.provideMerge(RepoSourceLive({ rootDir: flags.cwd })));

    const program = Effect.gen(function* () {
      const repo = yield* RepoSource;
      const acquired = yield* repo.acquireDiff(target);
      const files = flags.onlyPath ? acquired.filter((f) => f.path === flags.onlyPath) : acquired;
      const compressed = compressDiff(files, {
        pathFilters: fileConfig.pathFilters,
        maxFilesReviewed: flags.maxFiles ?? fileConfig.maxFiles,
        chunk: true,
      });
      if (compressed.files.length === 0) {
        yield* Console.log(colors.gray('No reviewable changes.'));
        return;
      }
      yield* Console.error(colors.gray(`Reviewing ${compressed.files.length} file(s) with ${provider}…`));
      const result = yield* runReview(compressed.files, target, {
        profile: flags.profile ?? fileConfig.profile,
        codingStandards,
        pathInstructions: fileConfig.pathInstructions,
        confidenceThreshold: fileConfig.confidenceThreshold,
        categoryThresholds: fileConfig.categoryThresholds,
        pathThresholds: fileConfig.pathThresholds,
        suppressAdvisory: fileConfig.suppressAdvisory,
        maxFindings: flags.maxFindings ?? fileConfig.maxFindings,
        maxChunkTokens: fileConfig.maxChunkTokens,
        maxChunks: fileConfig.maxChunks,
        reviewConcurrency: fileConfig.reviewConcurrency,
        learnings,
        verify: flags.verify,
        task: flags.thorough ? 'deep' : 'review',
      });
      if (result.chunkCount > 1) {
        yield* Console.error(colors.gray(`Reviewed in ${result.chunkCount} passes (large diff).`));
      }
      if (result.skippedForSize.length > 0 && flags.format !== 'md') {
        yield* Console.error(
          colors.yellow(
            `! ${result.skippedForSize.length} file(s) not reviewed (size budget). Raise maxChunks or split the change.`
          )
        );
      }
      yield* emit(result, flags.format);
    });

    yield* program.pipe(Effect.provide(layer));
  });
}

// ---------------------------------------------------------------------------
// Shared options
// ---------------------------------------------------------------------------

const cwdOpt = Options.directory('cwd', { exists: 'yes' }).pipe(
  Options.withAlias('C'),
  Options.withDescription('Repository working directory'),
  Options.withDefault(process.cwd())
);
const providerOpt = Options.choice('provider', PROVIDERS).pipe(
  Options.withDescription('Model provider (overrides config)'),
  Options.optional
);
const formatOpt = Options.choice('format', ['md', 'sarif', 'json'] as const).pipe(
  Options.withDescription('Output format'),
  Options.withDefault('md' as const)
);

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

const reviewCommand = Command.make(
  'review',
  {
    cwd: cwdOpt,
    base: Options.text('base').pipe(Options.withDescription('Base ref to diff against'), Options.optional),
    head: Options.text('head').pipe(Options.withDescription('Head ref (default HEAD)'), Options.optional),
    provider: providerOpt,
    profile: Options.choice('profile', ['chill', 'assertive'] as const).pipe(Options.optional),
    format: formatOpt,
    maxFiles: Options.integer('max-files').pipe(Options.optional),
    maxFindings: Options.integer('max-findings').pipe(Options.optional),
    thorough: Options.boolean('thorough').pipe(Options.withDescription('Use the strongest model + extra passes')),
    noVerify: Options.boolean('no-verify').pipe(Options.withDescription('Skip the grounding verifier')),
    print: Options.boolean('print').pipe(
      Options.withDescription('Print findings locally (default; posting to GitHub is via the Action)')
    ),
  },
  (a) =>
    runReviewFlow({
      cwd: a.cwd,
      base: opt(a.base),
      head: opt(a.head),
      provider: opt(a.provider),
      profile: opt(a.profile),
      format: a.format,
      maxFiles: opt(a.maxFiles),
      maxFindings: opt(a.maxFindings),
      thorough: a.thorough,
      verify: !a.noVerify,
    })
).pipe(Command.withDescription('Review a local diff/branch and print findings.'));

// ---------------------------------------------------------------------------
// explain <path>
// ---------------------------------------------------------------------------

const explainCommand = Command.make(
  'explain',
  {
    path: Args.text({ name: 'path' }),
    cwd: cwdOpt,
    provider: providerOpt,
    format: formatOpt,
  },
  (a) =>
    runReviewFlow({
      cwd: a.cwd,
      provider: opt(a.provider),
      format: a.format,
      thorough: false,
      verify: true,
      onlyPath: a.path,
    })
).pipe(Command.withDescription('Review just the changes to a single file.'));

// ---------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------

const checkCommand = Command.make('check', { cwd: cwdOpt, provider: providerOpt }, ({ cwd, provider }) =>
  Effect.gen(function* () {
    const config = yield* loadFileConfig(cwd);
    const resolved: CliProvider = opt(provider) ?? config.provider ?? 'anthropic';
    const envVar = providerKeyEnv(resolved);
    const hasKey = envVar ? Boolean(process.env[envVar]) : false;

    yield* Console.log(colors.bold('lupe check'));
    yield* Console.log(`  provider: ${colors.cyan(resolved)}`);
    yield* Console.log(`  profile:  ${config.profile ?? 'chill'}`);
    if (config.models) yield* Console.log(`  models:   ${JSON.stringify(config.models)}`);
    if (envVar) {
      yield* Console.log(`  ${envVar}: ${hasKey ? colors.green('set') : colors.red('missing')}`);
    }
    if (isLocalProvider(resolved)) {
      yield* Console.log(colors.yellow(`  uses your local ${resolved} login (unofficial — see ToS notice on use)`));
      yield* Console.log(colors.green('✓ ready (ensure you are logged in)'));
    } else if (envVar && !hasKey && resolved !== 'bedrock' && resolved !== 'gateway') {
      yield* Console.error(colors.yellow(`! Set ${envVar} before running a review.`));
    } else {
      yield* Console.log(colors.green('✓ ready'));
    }
  })
).pipe(Command.withDescription('Validate config and provider credentials.'));

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

const initCommand = Command.make('init', { cwd: cwdOpt }, ({ cwd }) =>
  Effect.tryPromise({
    try: async () => {
      clack.intro('🔍 lupe init');
      const provider = await clack.select({
        message: 'Which model provider will you use?',
        options: PROVIDERS.map((p) => ({ value: p, label: p })),
        initialValue: 'anthropic' as CliProvider,
      });
      if (clack.isCancel(provider)) {
        clack.cancel('Cancelled.');
        return;
      }
      const profile = await clack.select({
        message: 'Review profile?',
        options: [
          { value: 'chill', label: 'chill — only high-confidence, medium+ findings' },
          { value: 'assertive', label: 'assertive — surface more, lower-severity findings' },
        ],
        initialValue: 'chill',
      });
      if (clack.isCancel(profile)) {
        clack.cancel('Cancelled.');
        return;
      }

      const config: Record<string, unknown> = {
        profile,
        provider,
        path_filters: ['!**/dist/**', '!**/*.lock'],
        max_findings: 8,
      };
      const target = nodePath.join(cwd, '.lupe.yaml');
      await fs.writeFile(target, stringifyYaml(config), 'utf8');
      const envVar = providerKeyEnv(provider as CliProvider);
      clack.note(
        `Wrote ${nodePath.relative(process.cwd(), target) || '.lupe.yaml'}` +
          (envVar ? `\nRemember to export ${envVar} before running \`lupe review\`.` : ''),
        'Done'
      );
      clack.outro('Run `lupe review` to review your current changes.');
    },
    catch: (cause) => new ConfigError({ message: 'init failed', cause }),
  })
).pipe(Command.withDescription('Scaffold a .lupe.yaml config interactively.'));

// ---------------------------------------------------------------------------
// learn <pattern>
// ---------------------------------------------------------------------------

const learnCommand = Command.make(
  'learn',
  { pattern: Args.text({ name: 'pattern' }), cwd: cwdOpt },
  ({ pattern, cwd }) =>
    addLearning(cwd, pattern).pipe(
      Effect.zipRight(
        Console.log(colors.green(`✓ lupe will suppress findings matching "${pattern}" (.lupe/learnings.json)`))
      )
    )
).pipe(Command.withDescription('Teach lupe to stop reporting a recurring false positive.'));

// ---------------------------------------------------------------------------
// describe
// ---------------------------------------------------------------------------

interface DescribeFlags {
  readonly cwd: string;
  readonly base?: string;
  readonly head?: string;
  readonly provider?: CliProvider;
  readonly print: boolean;
}

function runDescribeFlow(flags: DescribeFlags) {
  return Effect.gen(function* () {
    const fileConfig = yield* loadFileConfig(flags.cwd);
    const codingStandards = discoverCodingStandards({ rootDir: flags.cwd, explicit: fileConfig.codingStandards });
    const provider: CliProvider = flags.provider ?? fileConfig.provider ?? 'anthropic';
    const target: ReviewTarget = { kind: 'local', baseRef: flags.base, headRef: flags.head };

    const aiLayer = isLocalProvider(provider)
      ? provider === 'claude-cli'
        ? ClaudeCliLive()
        : CodexCliLive()
      : AiSdkLive({ provider, models: fileConfig.models, baseURL: fileConfig.baseURL });
    const layer = aiLayer.pipe(Layer.provideMerge(RepoSourceLive({ rootDir: flags.cwd })));

    const program = Effect.gen(function* () {
      const repo = yield* RepoSource;
      const acquired = yield* repo.acquireDiff(target);
      const compressed = compressDiff(acquired, {
        pathFilters: fileConfig.pathFilters,
        maxFilesReviewed: fileConfig.maxFiles,
        chunk: false,
      });
      if (compressed.files.length === 0) {
        yield* Console.log(colors.gray('No reviewable changes.'));
        return;
      }
      yield* Console.error(colors.gray(`Describing ${compressed.files.length} file(s) with ${provider}…`));
      const result = yield* generateDescription(compressed.files, target, { codingStandards });
      const markdown = renderDescription(result.description);
      yield* Console.log(markdown);
    });

    yield* program.pipe(Effect.provide(layer));
  });
}

const describeCommand = Command.make(
  'describe',
  {
    cwd: cwdOpt,
    base: Options.text('base').pipe(Options.withDescription('Base ref to diff against'), Options.optional),
    head: Options.text('head').pipe(Options.withDescription('Head ref (default HEAD)'), Options.optional),
    provider: providerOpt,
    print: Options.boolean('print').pipe(Options.withDescription('Print description to stdout')),
  },
  (flags) =>
    runDescribeFlow({
      cwd: flags.cwd,
      base: opt(flags.base),
      head: opt(flags.head),
      provider: opt(flags.provider),
      print: flags.print,
    })
).pipe(Command.withDescription('Generate a PR description from the diff.'));

// ---------------------------------------------------------------------------
// Assemble + run
// ---------------------------------------------------------------------------

const lupe = Command.make('lupe').pipe(
  Command.withDescription('Platform- and provider-agnostic AI code review agent.'),
  Command.withSubcommands([reviewCommand, explainCommand, checkCommand, initCommand, learnCommand, describeCommand])
);

const run = Command.run(lupe, { name: 'lupe', version: VERSION });

const reportAndExit = (message: string) =>
  Console.error(colors.red(`✖ ${message}`)).pipe(Effect.zipRight(Effect.sync(() => process.exit(1))));

run(process.argv).pipe(
  Effect.catchTags({
    ConfigError: (e) => reportAndExit(e.message),
    ProviderError: (e) => reportAndExit(`${e.message}${e.provider ? ` (provider: ${e.provider})` : ''}`),
    RateLimitError: (e) => reportAndExit(`rate limited: ${e.message}`),
    RefusalError: (e) => reportAndExit(`model refused: ${e.message}`),
    ReviewOutputError: (e) => reportAndExit(e.message),
    DiffParseError: (e) => reportAndExit(e.message),
  }),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
);
