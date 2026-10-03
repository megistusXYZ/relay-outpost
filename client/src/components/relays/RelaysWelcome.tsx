/**
 * Relays, for someone who doesn't run one yet (owner, 2026-10-03: "make this
 * feel more Relay Outpost … about the user and the experience, not the
 * protocol").
 *
 * It talks about a community and its home: what you get, how to start, and —
 * quietly, below — connecting one you already have. The protocol's word,
 * "relay", appears once, to name the thing. The ways to start are plain links
 * to the provider (lib/relay-start-options.ts): we never host it, never take a
 * cut, never stand in between.
 *
 * Presentational only — no session, no relay calls — so it renders anywhere
 * (and in tests).
 */
import { Link } from "wouter";
import { ArrowUpRight, Check, ChevronRight } from "lucide-react";
import { START_OPTIONS, type StartOption } from "@/lib/relay-start-options";
import { ConnectIcon, HomeRing, HostedIcon, KeepIcon, PhoneIcon, RulesIcon, SelfHostIcon } from "./relays-icons";

const BENEFITS = [
  { Icon: RulesIcon, title: "Your members, your rules", line: "Decide who joins, what stays up and who's out." },
  { Icon: PhoneIcon, title: "Moderate from your phone", line: "Reports, requests and posts in one calm inbox." },
  { Icon: KeepIcon, title: "Yours to keep", line: "Move to another provider anytime. Your community comes with you." },
] as const;

const OPTION_ICON = { hosted: HostedIcon, self: SelfHostIcon } as const;

function OptionCard({ option }: { option: StartOption }) {
  const Icon = OPTION_ICON[option.id];
  const featured = !!option.recommended;
  return (
    <section
      className={`relative flex flex-col rounded-2xl p-6 ${featured
        ? "border border-brand/40 bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--brand)/0.10),transparent_60%)] shadow-[0_0_0_1px_hsl(var(--brand)/0.06),0_12px_40px_-16px_hsl(var(--brand)/0.45)]"
        : "border border-black/[0.08] dark:border-white/[0.08]"}`}
      data-testid={`relays-start-${option.id}`}
    >
      <div className="flex items-center justify-between gap-3">
        <Icon className={`w-6 h-6 ${featured ? "text-brand" : "text-foreground/70"}`} />
        {featured && <span className="text-[12px] font-medium tracking-wide text-brand" data-testid="relays-start-recommended">Recommended</span>}
      </div>
      <h3 className="mt-5 text-[18px] font-semibold tracking-tight">{option.title}</h3>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">{option.forWho}</p>
      <ul className="mt-5 space-y-2.5 border-t border-black/[0.06] dark:border-white/[0.06] pt-5">
        {option.points.map((p) => (
          <li key={p} className="flex items-center gap-2.5 text-[14px] text-foreground/90">
            <Check className={`w-4 h-4 shrink-0 ${featured ? "text-brand" : "text-muted-foreground"}`} strokeWidth={2} aria-hidden="true" />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-6">
        <a
          href={option.href}
          target="_blank"
          rel="noopener noreferrer"
          className={featured
            ? "inline-flex w-full min-h-[48px] items-center justify-center gap-1.5 rounded-full bg-brand px-5 text-[15px] font-semibold text-background transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            : "inline-flex w-full min-h-[48px] items-center justify-center gap-1.5 rounded-full border border-black/[0.12] dark:border-white/[0.14] px-5 text-[15px] font-medium transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"}
          data-testid={`relays-start-${option.id}-go`}
        >
          {option.cta}
          <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

export function RelaysWelcome() {
  return (
    <div className="relative max-w-3xl mx-auto px-4 pt-10 pb-16 sm:pt-14" data-testid="relays-welcome">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-[radial-gradient(55%_100%_at_50%_0%,hsl(var(--brand)/0.16),transparent_70%)]" aria-hidden="true" />

      <header className="flex flex-col items-center text-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
        <HomeRing size={120} />
        <h1 className="mt-6 text-[32px] sm:text-[44px] font-semibold leading-[1.05] tracking-[-0.02em] [font-family:var(--font-display)] [text-wrap:balance]">
          Give your community a home
        </h1>
        <p className="mt-4 max-w-[42ch] text-[16px] sm:text-[17px] leading-relaxed text-muted-foreground [text-wrap:pretty]">
          Your own space for posts and members, with your rules. A provider keeps it running; you run it from here.
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground/80" data-testid="relays-welcome-term">On Nostr, a space like this is called a relay.</p>
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
      <div className="grid gap-4 sm:grid-cols-2" data-testid="relays-start">
        {START_OPTIONS.map((o) => <OptionCard key={o.id} option={o} />)}
      </div>

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
        You own it. Relay Outpost never hosts your community or takes a cut — you pay your provider directly.
      </p>
    </div>
  );
}

export default RelaysWelcome;
