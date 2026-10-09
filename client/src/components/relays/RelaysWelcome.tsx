/**
 * Relays, for someone who doesn't run one yet (owner, 2026-10-03: "make this
 * feel more Relay Outpost … about the user and the experience, not the
 * protocol").
 *
 * It talks about a relay as a space of your own — your people, their posts,
 * your rules (owner, 2026-10-09: "relay", and make it feel like a space or a
 * community): what you get, how to start, and — quietly, below — connecting
 * one you already have. No protocol words beyond that (owner, 2026-10-03).
 * The ways to start are plain links
 * to the provider (lib/relay-start-options.ts): we never host it, never take a
 * cut, never stand in between.
 *
 * Presentational only — no session, no relay calls — so it renders anywhere
 * (and in tests).
 */
import { Link } from "wouter";
import { ArrowUpRight, Check, ChevronRight } from "lucide-react";
import { BUILD_YOUR_OWN, START_OPTIONS, type StartOption } from "@/lib/relay-start-options";
import { ConnectIcon, HomeRing, KeepIcon, PhoneIcon, RulesIcon, SelfHostIcon } from "./relays-icons";
import { RelayToolsLogo } from "./RelayToolsLogo";

const BENEFITS = [
  { Icon: RulesIcon, title: "Your members, your rules", line: "Decide who joins, what stays up and who's out." },
  { Icon: PhoneIcon, title: "Moderate from your phone", line: "Reports, requests and posts in one calm inbox." },
  { Icon: KeepIcon, title: "Yours to keep", line: "Move to another provider anytime. Your relay comes with you." },
] as const;

/**
 * Hosted: one wide featured card — the pitch on the left, the facts and the
 * button on the right on a wide screen; stacked on a phone. Sized by its own
 * content, never stretched to match something beside it.
 */
export function HostedCard({ option }: { option: StartOption }) {
  return (
    <section
      className="relative rounded-2xl border border-brand/40 p-6 sm:p-7 bg-[radial-gradient(120%_120%_at_0%_0%,hsl(var(--brand)/0.10),transparent_55%)] shadow-[0_0_0_1px_hsl(var(--brand)/0.06),0_12px_40px_-16px_hsl(var(--brand)/0.45)]"
      data-testid={`relays-start-${option.id}`}
    >
      <div className="grid gap-6 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] sm:gap-8 sm:items-center">
        <div>
          <div className="flex items-center justify-between gap-3">
            {/* The provider's own mark, so it's clear who keeps it running. */}
            <RelayToolsLogo className="h-7 w-auto text-foreground" />
            {option.recommended && <span className="text-[12px] font-medium tracking-wide text-brand sm:hidden" data-testid="relays-start-recommended">Recommended</span>}
          </div>
          <h3 className="mt-4 flex items-baseline gap-2.5 text-[20px] font-semibold tracking-tight">
            {option.title}
            {option.recommended && <span className="hidden sm:inline text-[12px] font-medium tracking-wide text-brand" data-testid="relays-start-recommended-wide">Recommended</span>}
          </h3>
          <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{option.forWho}</p>
        </div>
        <div className="sm:border-l sm:border-black/[0.06] sm:dark:border-white/[0.08] sm:pl-8">
          <ul className="space-y-2.5">
            {option.points.map((p) => (
              <li key={p} className="flex items-center gap-2.5 text-[14px] text-foreground/90">
                <Check className="w-4 h-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
          <a
            href={option.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex w-full min-h-[48px] items-center justify-center gap-1.5 rounded-full bg-brand px-5 text-[15px] font-semibold text-background transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            data-testid={`relays-start-${option.id}-go`}
          >
            {option.cta}
            <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * Run it yourself: an open section, not a box — a heading line, then the
 * software as hairline tiles (two by two on a wide screen, one column on a
 * phone), each linking to its own project.
 */
export function SelfHostSection({ option }: { option: StartOption }) {
  return (
    <section className="mt-10" data-testid={`relays-start-${option.id}`}>
      <div className="flex items-start gap-3">
        <SelfHostIcon className="w-6 h-6 shrink-0 text-foreground/70 mt-0.5" />
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold tracking-tight">Or {option.title.toLowerCase()}</h3>
          <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
            {option.forWho} {option.points.map((p, i) => (i === 0 ? p : p.charAt(0).toLowerCase() + p.slice(1))).join(", ")}.
          </p>
        </div>
      </div>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2" data-testid="relays-software">
        {(option.software ?? []).map((sw) => (
          <li key={sw.name} className="flex">
            <a
              href={sw.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex w-full items-start gap-3 min-h-[56px] rounded-xl border border-black/[0.08] dark:border-white/[0.08] px-4 py-3.5 transition-colors hover:border-brand/40 hover:bg-brand/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="relays-software-link"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[15px] font-semibold tracking-tight">{sw.name}</span>
                  <span className="text-[12px] font-medium text-brand">{sw.bestFor}</span>
                </span>
                <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{sw.line}</span>
              </span>
              <ArrowUpRight className="mt-1 w-4 h-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 px-1 text-[12px] text-muted-foreground">
        Developers can build their own with{" "}
        <a href={BUILD_YOUR_OWN.href} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground/80 underline-offset-4 hover:underline">{BUILD_YOUR_OWN.name}</a>.
      </p>
    </section>
  );
}

export function RelaysWelcome() {
  return (
    <div className="relative max-w-3xl mx-auto px-4 pt-10 pb-16 sm:pt-14" data-testid="relays-welcome">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(55%_100%_at_50%_0%,hsl(var(--brand)/0.16),transparent_70%)]" aria-hidden="true" />

      <header className="flex flex-col items-center text-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
        <HomeRing size={132} />
        <h1 className="mt-6 text-[32px] sm:text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] [font-family:var(--font-display)] [text-wrap:balance]">
          Give your relay a home
        </h1>
        <p className="mt-4 max-w-[42ch] text-[16px] sm:text-[17px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
          A relay is a space of your own: your people, their posts, your rules. A provider keeps it running; you run it from here.
        </p>
      </header>

      <ul className="mt-12 grid sm:grid-cols-3 border-y border-black/[0.06] dark:border-white/[0.06] divide-y sm:divide-y-0 sm:divide-x divide-black/[0.06] dark:divide-white/[0.06]" aria-label="What you get" data-testid="relays-benefits">
        {BENEFITS.map(({ Icon, title, line }) => (
          <li key={title} className="flex items-start gap-3 py-5 sm:flex-col sm:gap-3 sm:px-5 first:sm:pl-1 last:sm:pr-1">
            <Icon className="w-5 h-5 shrink-0 text-brand mt-0.5 sm:mt-0" />
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold tracking-tight">{title}</span>
              <span className="mt-0.5 block text-[14px] leading-snug text-muted-foreground">{line}</span>
            </span>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 mb-4 text-[13px] font-medium tracking-wide text-muted-foreground">Choose how to start</h2>
      <StartOptions />

      <Link
        href="/my-relays/connect"
        className="group mt-8 flex items-center gap-4 min-h-[64px] border-y border-black/[0.06] dark:border-white/[0.06] px-1 py-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        data-testid="relays-connect"
      >
        <ConnectIcon className="w-6 h-6 shrink-0 text-foreground/70 group-hover:text-brand transition-colors" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold tracking-tight">Already have one? Connect it</span>
          <span className="block text-[14px] text-muted-foreground leading-snug">We'll check it's yours and show what you can do.</span>
        </span>
        <ChevronRight className="w-5 h-5 text-muted-foreground/70 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>

      <p className="mt-8 text-center text-[13px] leading-relaxed text-muted-foreground [text-wrap:balance]">
        You own it. Relay Outpost never hosts your relay or takes a cut — you pay your provider directly.
      </p>
      <p className="mt-3 text-center text-[13px] text-muted-foreground">
        Building something?{" "}
        <Link href="/my-relays/console" className="font-medium text-foreground/80 underline-offset-4 hover:underline" data-testid="relays-console-link">Open the console</Link>
      </p>
    </div>
  );
}

/** Both ways to start, for anywhere that offers them (the welcome, Add a relay). */
export function StartOptions() {
  return (
    <div data-testid="relays-start">
      {START_OPTIONS.map((o) => (o.software ? <SelfHostSection key={o.id} option={o} /> : <HostedCard key={o.id} option={o} />))}
    </div>
  );
}

export default RelaysWelcome;
