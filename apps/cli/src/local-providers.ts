import { spawn } from 'node:child_process';

import { Effect, Layer } from 'effect';

import {
  AiModel,
  EMPTY_USAGE,
  Finding,
  ProviderError,
  findingsJsonSchema,
  type AiError,
  type AiModelService,
  type GenerateFindingsInput,
  type GenerateFindingsResult,
  type VerifyInput,
  type VerifyResult,
} from '@gigadrive/lupe-core';

import { colors } from './render';

/**
 * Local-credential AI backends. These spawn the user's OWN already-authenticated
 * official CLI (`claude` / `codex`) — lupe never reads, writes, or forwards any
 * token. Strictly opt-in: subscription reuse is a ToS gray area with no published
 * carve-out, so a notice is printed on selection and API keys remain the default.
 */

// ---------------------------------------------------------------------------
// JSON extraction (robust to surrounding prose / JSONL events)
// ---------------------------------------------------------------------------

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Extract the first balanced `[...]` / `{...}` block from arbitrary text. */
export function extractFirstJson(text: string, open: '[' | '{'): string | undefined {
  const close = open === '[' ? ']' : '}';
  const start = text.indexOf(open);
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Coerce model text into validated findings (lenient — drops invalid elements). */
export function coerceFindings(text: string): Finding[] {
  const block = extractFirstJson(text, '[');
  const parsed = block ? tryParse(block) : undefined;
  if (!Array.isArray(parsed)) return [];
  const findings: Finding[] = [];
  for (const item of parsed) {
    const result = Finding.safeParse(item);
    if (result.success) findings.push(result.data);
  }
  return findings;
}

export function coerceVerify(text: string): { grounded: boolean; reason: string } {
  const block = extractFirstJson(text, '{');
  const parsed = block ? tryParse(block) : undefined;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    return { grounded: obj.grounded === true, reason: typeof obj.reason === 'string' ? obj.reason : '' };
  }
  // If the model couldn't produce JSON, default to keeping the finding.
  return { grounded: true, reason: 'verifier output unparsable; kept' };
}

// ---------------------------------------------------------------------------
// Subprocess
// ---------------------------------------------------------------------------

function runCommand(command: string, args: readonly string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args as string[], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'ENOENT'
          ? new Error(`'${command}' was not found on PATH. Install it and log in, then retry.`)
          : err
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

interface Backend {
  readonly label: 'claude-cli' | 'codex-cli';
  readonly command: string;
  readonly args: readonly string[];
  /** Extract the model's text from the backend's raw stdout. */
  readonly extractText: (stdout: string) => string;
}

const CLAUDE_BACKEND: Backend = {
  label: 'claude-cli',
  command: 'claude',
  args: ['-p', '--output-format', 'json'],
  extractText: (stdout) => {
    const parsed = tryParse(stdout.trim());
    if (parsed && typeof parsed === 'object' && typeof (parsed as { result?: unknown }).result === 'string') {
      return (parsed as { result: string }).result;
    }
    return stdout;
  },
};

const CODEX_BACKEND: Backend = {
  label: 'codex-cli',
  command: 'codex',
  args: ['exec', '--json', '-'],
  extractText: (stdout) => {
    // codex emits JSONL events; collect the longest string leaf (the assistant text).
    let best = '';
    for (const line of stdout.split('\n')) {
      const value = tryParse(line.trim());
      if (value === undefined) continue;
      for (const leaf of stringLeaves(value)) if (leaf.length >= best.length) best = leaf;
    }
    return best || stdout;
  },
};

function* stringLeaves(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* stringLeaves(v);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* stringLeaves(v);
}

function makeLocalModel(backend: Backend): AiModelService {
  const fail = (error: unknown): AiError =>
    new ProviderError({
      message: error instanceof Error ? error.message : String(error),
      provider: backend.label,
    });

  const generateFindings = (input: GenerateFindingsInput): Effect.Effect<GenerateFindingsResult, AiError> =>
    Effect.tryPromise({
      try: async () => {
        const prompt =
          `${input.system}\n\n${input.prompt}\n\n` +
          `Return ONLY a JSON array of findings matching this JSON Schema. No markdown, no commentary:\n` +
          `${JSON.stringify(findingsJsonSchema())}`;
        const stdout = await runCommand(backend.command, backend.args, prompt);
        return {
          findings: coerceFindings(backend.extractText(stdout)),
          usage: EMPTY_USAGE,
          model: backend.label,
          steps: 1,
        };
      },
      catch: fail,
    });

  const verify = (input: VerifyInput): Effect.Effect<VerifyResult, AiError> =>
    Effect.tryPromise({
      try: async () => {
        const prompt =
          `${input.system}\n\nFinding: ${input.candidate.title} — ${input.candidate.message}\n` +
          `Location: ${input.candidate.path}:${input.candidate.startLine}\n\n` +
          `Code context:\n${input.evidenceContext}\n\n` +
          `Return ONLY a JSON object {"grounded": boolean, "reason": string}.`;
        const stdout = await runCommand(backend.command, backend.args, prompt);
        const { grounded, reason } = coerceVerify(backend.extractText(stdout));
        return { grounded, reason, usage: EMPTY_USAGE, model: backend.label };
      },
      catch: fail,
    });

  return { generateFindings, verify };
}

let noticePrinted = false;

function printNotice(label: string, conflictingEnv?: string): void {
  if (!noticePrinted) {
    process.stderr.write(
      colors.yellow(
        `⚠ Using your local ${label} login is unofficial and may violate the provider's Terms of Service.\n` +
          `  lupe only invokes your already-authenticated CLI and never handles tokens. Prefer API keys for shared/CI use.\n`
      )
    );
    noticePrinted = true;
  }
  if (conflictingEnv && process.env[conflictingEnv]) {
    process.stderr.write(
      colors.yellow(
        `⚠ ${conflictingEnv} is set and may override your subscription login. Unset it to use the subscription.\n`
      )
    );
  }
}

/** Opt-in layer backed by the local Claude Code login (`claude -p`). */
export function ClaudeCliLive(): Layer.Layer<AiModel> {
  return Layer.sync(AiModel, () => {
    printNotice('Claude Code', 'ANTHROPIC_API_KEY');
    return makeLocalModel(CLAUDE_BACKEND);
  });
}

/** Opt-in layer backed by the local Codex login (`codex exec`). */
export function CodexCliLive(): Layer.Layer<AiModel> {
  return Layer.sync(AiModel, () => {
    printNotice('Codex', 'OPENAI_API_KEY');
    return makeLocalModel(CODEX_BACKEND);
  });
}

export const LOCAL_PROVIDERS = ['claude-cli', 'codex-cli'] as const;
export type LocalProvider = (typeof LOCAL_PROVIDERS)[number];

export function isLocalProvider(p: string): p is LocalProvider {
  return (LOCAL_PROVIDERS as readonly string[]).includes(p);
}
