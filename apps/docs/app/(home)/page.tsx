import { ArrowRight, GitBranch, KeyRound, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

const features = [
  {
    icon: KeyRound,
    title: 'Bring your own tokens',
    description:
      'No SaaS, no per-seat pricing. lupe runs on your own provider key — Anthropic, OpenAI, Google, Bedrock, or an OpenAI-compatible gateway.',
  },
  {
    icon: GitBranch,
    title: 'Two surfaces, one engine',
    description:
      'The same review engine powers a GitHub Action for pull requests and a local CLI for your terminal, plus an embeddable SDK.',
  },
  {
    icon: ShieldCheck,
    title: 'Precision-first',
    description:
      'High-recall detection is gated by a grounding verifier and a filter chain, aiming for a handful of actionable comments per PR — not noise.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-24 text-center">
        <span className="mb-4 text-5xl" aria-hidden>
          🔍
        </span>
        <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">Provider-agnostic AI code review</h1>
        <p className="mb-8 max-w-2xl text-lg text-fd-muted-foreground">
          lupe is an open-source, bring-your-own-token AI code review agent — a self-hosted alternative to CodeRabbit,
          Cursor Bugbot, and Greptile that runs on your own model tokens.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs"
            className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started
            <ArrowRight className="size-4" />
          </Link>
          <a
            href="https://github.com/gigadrive/lupe"
            className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            View on GitHub
          </a>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-4 pb-24 sm:grid-cols-3">
        {features.map((feature) => (
          <div key={feature.title} className="rounded-xl border border-fd-border bg-fd-card p-6">
            <feature.icon className="mb-3 size-6 text-fd-primary" />
            <h2 className="mb-2 text-lg font-semibold">{feature.title}</h2>
            <p className="text-sm text-fd-muted-foreground">{feature.description}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
