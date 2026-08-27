import { useRef, useState, useEffect } from "react";
import { BtcZapIcon } from "@/components/icons/BtcZapIcon";
import { Link } from "wouter";
import { Rocket, Globe, Download, Check, ArrowUpRight } from "lucide-react";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { compactCount } from "@/lib/compact-count";
import { RelayOutpostIcon } from "@/components/RelayOutpostLoader";
import { AmbientVideo } from "@/components/landing/HeroAmbientVideo";

/**
 * Marketing content shown below the warp hero on the landing screen: the
 * "what it unlocks" editorial section (alternating photo/copy panels that
 * reveal on scroll), a final sign-in CTA, and a footer with the install action.
 * Photos are self-hosted webp in /public/images/landing and lazy-loaded; swap
 * them for brand photography anytime by editing the `image` fields below.
 * Copy is plain-language and free of network jargon.
 */

// Ecosystem apps your account works with — same account, open across these.
// Alphabetical; logo files map to the originally-pasted icons.
const ECOSYSTEM_APPS: { name: string; href: string; logo: string }[] = [
  { name: "Amethyst", href: "https://amethyst.social", logo: "/images/landing/partners/partner-1.webp" },
  { name: "Damus",    href: "https://damus.io",        logo: "/images/landing/partners/partner-3.webp" },
  { name: "Ditto",    href: "https://ditto.pub",       logo: "/images/landing/partners/partner-5.webp" },
  { name: "Primal",   href: "https://primal.net",      logo: "/images/landing/partners/partner-2.webp" },
  { name: "Wisp",     href: "https://wisp.mobile",     logo: "/images/landing/partners/partner-4.webp" },
];

// Relay software the operator works with — manageable via the NIP-86 Relay
// Management API. Links go to each project's GitHub. Alphabetical.
const COMPATIBLE_RELAYS: { name: string; href: string }[] = [
  { name: "Haven", href: "https://github.com/barrydeen/haven" },
  { name: "Khatru", href: "https://github.com/fiatjaf/khatru" },
  { name: "Pyramid", href: "https://github.com/fiatjaf/pyramid" },
  { name: "strfry", href: "https://github.com/hoytech/strfry" },
];

// Lightning wallets users can add to their profile to receive zaps (a
// Lightning address → NIP-57 zaps). Only wallets that issue a real address.
// Alphabetical. `h` is a per-logo display height (px) that optically balances
// the row — longer wordmarks get slightly less height so they all read the
// same visual size.
const BITCOIN_WALLETS: { name: string; href: string; logo: string; h: number }[] = [
  { name: "Alby", href: "https://getalby.com", logo: "/images/landing/partners/wallet-alby.webp", h: 21 },
  { name: "Blink", href: "https://blink.sv", logo: "/images/landing/partners/wallet-blink.webp", h: 20 },
  { name: "Coinos", href: "https://coinos.io", logo: "/images/landing/partners/wallet-coinos.webp", h: 18 },
  { name: "Strike", href: "https://strike.me", logo: "/images/landing/partners/wallet-strike.webp", h: 16 },
  { name: "Wallet of Satoshi", href: "https://www.walletofsatoshi.com", logo: "/images/landing/partners/wallet-wos.webp", h: 15 },
];

// The open standards this app is BUILT ON — each chip links to the spec or
// project home. Concord is our own protocol (canonical spec repo).
const BUILT_ON: { name: string; href: string }[] = [
  { name: "Nostr", href: "https://nostr.com" },
  { name: "Concord", href: "https://github.com/concord-protocol/concord" },
  { name: "Lightning", href: "https://lightning.network" },
  { name: "Cashu", href: "https://cashu.space" },
  { name: "Blossom", href: "https://github.com/hzrd149/blossom" },
  { name: "Podcasting 2.0", href: "https://podcastindex.org" },
];

// Services the app interoperates with beyond the icon row — marketplace,
// audio rooms, streams, music, media, wallet. Text chips (no logo assets
// needed); promote any of these into ECOSYSTEM_APPS when a logo lands.
const ALSO_WORKS_WITH: { name: string; href: string }[] = [
  { name: "Conduit", href: "https://conduit.market" },
  { name: "Corny Chat", href: "https://cornychat.com" },
  { name: "zap.stream", href: "https://zap.stream" },
  { name: "Wavlake", href: "https://wavlake.com" },
  { name: "DiVine", href: "https://divine.video" },
  { name: "npub.cash", href: "https://npub.cash" },
];

const GITHUB_REPO_URL = "https://github.com/megistusXYZ/relay-outpost";

/** The GitHub mark (octocat silhouette), inline so the landing bundle stays asset-free. */
function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * "Built in the open" — the repo is public and MIT-licensed, and this panel
 * says so with the receipts: a live star count when GitHub answers (its API is
 * CORS-open), and simply no number when it doesn't — absence, never a fake 0.
 */
function OpenSourcePanel() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("https://api.github.com/repos/megistusXYZ/relay-outpost", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j.stargazers_count === "number") setStars(j.stargazers_count);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  return (
    <div className="mt-12 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.015] p-7 sm:p-9" data-testid="landing-open-source">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-xl">
          <p className="text-[11px] font-brand uppercase tracking-[0.28em] text-white/65">Open source</p>
          <h3 className="mt-3 text-xl font-semibold text-white sm:text-2xl">Built in the open.</h3>
          <p className="mt-2.5 text-sm leading-relaxed text-white/70">
            Every line of Relay Outpost is public and MIT-licensed — read the code, file an issue,
            or ship a patch. Solutions shouldn't be a black box.
          </p>
        </div>
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group/gh inline-flex shrink-0 items-center gap-2.5 self-start rounded-xl border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-medium text-white transition-all duration-300 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/[0.1] motion-reduce:hover:translate-y-0 sm:self-center"
          data-testid="link-landing-github"
        >
          <GitHubMark className="h-5 w-5" />
          Star on GitHub
          {/* The count appears once it's a signal (≥10) — a real number that
              helps; "★ 0" on launch week would only argue against the button. */}
          {stars !== null && stars >= 10 && (
            <span className="rounded-full border border-white/15 bg-white/[0.08] px-2 py-0.5 text-[11px] tabular-nums text-white/80">
              ★ {compactCount(stars)}
            </span>
          )}
          <ArrowUpRight className="h-3.5 w-3.5 opacity-50 transition-opacity duration-300 group-hover/gh:opacity-90" />
        </a>
      </div>
    </div>
  );
}

interface Pillar {
  /** Short audience tag shown as an eyebrow beside the copy. */
  tag: string;
  title: string;
  body: React.ReactNode;
  /** Self-hosted webp under /public/images/landing — swap for brand photos.
   *  Doubles as the poster + the reduced-motion / Data Saver fallback when a
   *  `video` is set. */
  image: string;
  alt: string;
  /** Optional ambient clip that crossfades in over the photo. Self-hosted mp4
   *  under /public/videos; muted, looped, no controls. `videoMobile` is a
   *  smaller phone encode. */
  video?: string;
  videoMobile?: string;
}

// The comms cut (owner repositioning, 2026-08-18): three COMMUNICATION MODES,
// not three personas — public / private / value is the complete map of what a
// comms app does without ever listing a feature. Existing art is re-mapped,
// not re-shot: broadcast desk → public, gathering → private, command desk →
// value behind your words.
const PILLARS: Pillar[] = [
  {
    tag: "Say it publicly",
    title: "No one between you and your followers",
    body: "Your posts go out to everyone who follows you — no ranking system deciding who sees what. That's it — no tricks.",
    image: "/images/landing/creator-audience.webp",
    alt: "A creator's live broadcast desk — microphone, headphones, and audio",
    video: "/videos/creator-audience.mp4",
    videoMobile: "/videos/creator-audience-mobile.mp4",
  },
  {
    tag: "Say it privately",
    title: "Rooms only your people can read",
    body: "Direct messages and encrypted rooms stay actually private — the servers that carry them can't read them.",
    image: "/images/landing/community-host.webp",
    alt: "People gathering at an outdoor community event under string lights",
    video: "/videos/community-host.mp4",
    videoMobile: "/videos/community-host-mobile.mp4",
  },
  {
    tag: "Put value behind it",
    title: "Send a little thanks",
    body: (
      <>
        Money moves right where you talk — supporters can send you{" "}
        <span role="img" aria-label="bitcoin"><BtcZapIcon className="inline-block w-4 h-4 align-[-2px] text-[#F7931A]" /></span>
        , and you can send some right back. Simple as that.
      </>
    ),
    image: "/images/landing/operate-control.webp",
    alt: "A person running their community from a laptop over coffee in a cafe",
    video: "/videos/operate-control.mp4",
    videoMobile: "/videos/operate-control-mobile.mp4",
  },
];

/** Fades + lifts its children into view the first time they're scrolled to. */
function Reveal({ children, className = "", delayMs = 0 }: { children: React.ReactNode; className?: string; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setShown(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setShown(true); io.disconnect(); break; }
      }
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out will-change-transform ${shown ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"} ${className}`}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/**
 * A cover image that drifts vertically as it scrolls through the viewport
 * (subtle parallax). It's oversized inside its frame so the drift never reveals
 * an edge, and it writes the transform straight to the DOM (no re-render).
 * Skipped entirely under prefers-reduced-motion. Works with the landing's inner
 * scroll container via a capturing scroll listener.
 */
function ParallaxImage({ src, alt, strength = 26 }: { src: string; alt: string; strength?: number }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const progress = (r.top + r.height / 2 - vh / 2) / vh; // -ve above center, +ve below
      const offset = Math.max(-1, Math.min(1, progress)) * strength;
      el.style.transform = `translateY(calc(-50% + ${offset.toFixed(1)}px))`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strength]);
  const srcSm = src.replace(/\.webp$/, "-sm.webp");
  return (
    <img
      ref={ref}
      src={src}
      srcSet={`${srcSm} 640w, ${src} 1280w`}
      sizes="(max-width: 768px) 90vw, 45vw"
      alt={alt}
      loading="lazy"
      decoding="async"
      className="absolute left-0 top-1/2 h-[128%] w-full object-cover"
      style={{ transform: "translateY(-50%)" }}
    />
  );
}

/**
 * A looping ambient clip that crossfades in over a pillar's photo once it can
 * play, so the section breathes without ever reading as a video player. The
 * photo underneath stays the poster — and is the only thing shown under
 * prefers-reduced-motion or Data Saver, or before the card nears the viewport.
 * Decorative (aria-hidden): muted, no controls, autoplay, seamless loop, and
 * only fetched when scrolled near. Sits inside the card frame so it inherits
 * the same hover lift/scale as the image.
 *
 * `phaseSeconds` offsets where each clip starts in its 9s loop so the three
 * pillars never hit their brand sting in unison — the page feels alive rather
 * than synchronized.
 */
function PillarVideo({ src, mobileSrc, phaseSeconds = 0 }: { src: string; mobileSrc?: string; phaseSeconds?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mobile = !window.matchMedia("(min-width: 768px)").matches;
    setIsMobile(mobile);
    // Phones stay light: keep the static photo poster, never download/decode the
    // pillar clip. Ambient motion is a desktop-only delight.
    if (mobile) return;
    // No motion bytes at all for motion-sensitive users or Data Saver — the
    // photo poster stays.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    } catch { /* unsupported */ }
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setMounted(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setMounted(true); io.disconnect(); }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const videoSrc = isMobile && mobileSrc ? mobileSrc : src;

  return (
    <div ref={containerRef} aria-hidden className="absolute inset-0">
      {mounted && (
        <video
          key={videoSrc}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1200ms] ease-out ${shown ? "opacity-100" : "opacity-0"}`}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => { try { if (phaseSeconds) e.currentTarget.currentTime = phaseSeconds; } catch { /* seek unsupported */ } }}
          onCanPlay={() => setShown(true)}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      )}
    </div>
  );
}

/**
 * A full-bleed cosmic image softly blended into the page: low opacity, a radial
 * mask that fades every edge into the dark background (no hard seams), and a
 * gentle scroll parallax for depth. Decorative only (aria-hidden), lazy-loaded,
 * and responsive (mobile vs desktop webp). Respects prefers-reduced-motion.
 */
function SoftBackdrop({
  src, srcSm, position, mask, opacity = 0.5, strength = 34,
}: {
  src: string; srcSm: string; position: string; mask: string; opacity?: number; strength?: number;
}) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const progress = (r.top + r.height / 2 - vh / 2) / vh;
      const offset = Math.max(-1, Math.min(1, progress)) * strength;
      el.style.transform = `translateY(${offset.toFixed(1)}px) scale(1.08)`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [strength]);
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute -z-10 overflow-hidden ${position}`}
      style={{ opacity, WebkitMaskImage: mask, maskImage: mask }}
    >
      <img
        ref={ref}
        src={src}
        srcSet={`${srcSm} 800w, ${src} 1600w`}
        sizes="100vw"
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="h-full w-full object-cover"
        style={{ transform: "scale(1.08)" }}
      />
    </div>
  );
}

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-3">
      <div className="h-px w-6 bg-gradient-to-r from-transparent to-white/15" />
      <p className="text-[11px] font-brand uppercase tracking-[0.35em] text-brand/90">{children}</p>
      <div className="h-px w-6 bg-gradient-to-l from-transparent to-white/15" />
    </div>
  );
}

function PwaAction() {
  const { canInstall, promptInstall, isIOS, isStandalone } = useInstallPrompt();

  if (isStandalone) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-brand uppercase tracking-[0.15em] text-emerald-800/90 dark:text-emerald-300/90">
        <Check className="h-3.5 w-3.5" />
        Installed
      </span>
    );
  }
  if (canInstall) {
    return (
      <button
        onClick={() => { void promptInstall(); }}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-brand/30 bg-brand/[0.12] px-5 py-2.5 text-[11px] font-brand uppercase tracking-[0.18em] text-brand transition-colors hover:border-brand/50 hover:bg-brand/[0.2] active:scale-[0.98]"
        data-testid="button-install-pwa"
      >
        <Download className="h-4 w-4" />
        Install app
      </button>
    );
  }
  if (isIOS) {
    return (
      <p className="text-[11px] leading-relaxed text-white/70">
        On iPhone or iPad: tap <span className="text-white/80">Share</span> → <span className="text-white/80">Add to Home Screen</span>.
      </p>
    );
  }
  return (
    <p className="text-[11px] leading-relaxed text-white/55">
      Open the menu in your browser and choose <span className="text-white/80">Install</span> to add it to your device.
    </p>
  );
}

export function LandingMarketing({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="relative isolate w-full overflow-hidden pb-16">
      {/* Trade routes — softly blended behind the intro (What it unlocks
          header); fades top into the hero and bottom into the galaxy below */}
      <SoftBackdrop
        src="/images/landing/routes-bg.webp"
        srcSm="/images/landing/routes-bg-sm.webp"
        position="inset-x-0 top-0 h-[38%]"
        mask="radial-gradient(110% 72% at 50% 52%, #000 0%, #000 16%, transparent 60%)"
        opacity={0.14}
        strength={20}
      />
      {/* Galaxy — softly blended behind the middle; fades hard toward the top */}
      <SoftBackdrop
        src="/images/landing/galaxy-bg.webp"
        srcSm="/images/landing/galaxy-bg-sm.webp"
        position="inset-x-0 top-[30%] h-[46%]"
        mask="radial-gradient(110% 78% at 50% 56%, #000 0%, #000 28%, transparent 66%)"
        opacity={0.28}
        strength={26}
      />
      {/* Spacestation + ship — the last photo; bright area sits behind the CTA
          and fades out before the footer */}
      <SoftBackdrop
        src="/images/landing/station-bg.webp"
        srcSm="/images/landing/station-bg-sm.webp"
        position="inset-x-0 bottom-0 h-[54%]"
        mask="radial-gradient(120% 115% at 50% 32%, #000 0%, #000 22%, transparent 62%)"
        opacity={0.24}
        strength={20}
      />

      {/* ── What it unlocks — alternating editorial panels ──────────── */}
      <section className="mx-auto w-full max-w-6xl px-6 pt-8 pb-16 sm:pt-12">
        <Reveal>
          <div className="flex flex-col items-center gap-3 text-center">
            <SectionEyebrow>What it unlocks</SectionEyebrow>
            <h2 className="max-w-2xl text-balance font-brand text-3xl font-semibold leading-[1.1] tracking-tight text-white sm:text-4xl md:text-5xl">
              All your communications, one account.
            </h2>
            <p className="max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">
              Sign up once — no email, no password — and it works for everything. Post, chat, connect, done.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 space-y-16 sm:mt-20 sm:space-y-24">
          {PILLARS.map((p, i) => {
            const imageRight = i % 2 === 1;
            return (
              <div
                key={p.title}
                className="grid items-center gap-7 md:grid-cols-2 md:gap-12 lg:gap-16"
                data-testid="landing-pillar"
              >
                {/* Photo */}
                <Reveal className={imageRight ? "md:order-2" : ""}>
                  <div className="group relative">
                    <div aria-hidden className="pointer-events-none absolute -inset-4 rounded-[1.9rem] bg-brand/15 blur-3xl transition-all duration-500 ease-out group-hover:bg-brand/25" />
                    <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-gradient-to-br from-brand/15 via-white/[0.02] to-brand/10 shadow-[0_28px_70px_-24px_rgba(0,0,0,0.75)] transition-[transform,box-shadow,border-color] duration-500 ease-out will-change-transform group-hover:-translate-y-1 group-hover:border-white/25 group-hover:shadow-[0_42px_92px_-26px_rgba(91,46,162,0.5)] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                      <div className="relative aspect-[4/3] w-full overflow-hidden transition-transform duration-[650ms] ease-out group-hover:scale-[1.045] motion-reduce:group-hover:scale-100">
                        <ParallaxImage src={p.image} alt={p.alt} />
                        {p.video && <PillarVideo src={p.video} mobileSrc={p.videoMobile} phaseSeconds={(i * 10) / 3} />}
                      </div>
                      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
                      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10 transition-colors duration-500 group-hover:ring-white/20" />
                    </div>
                  </div>
                </Reveal>

                {/* Copy */}
                <Reveal delayMs={120} className={imageRight ? "md:order-1" : ""}>
                  <div className="max-w-md">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs tabular-nums text-brand/90">{String(i + 1).padStart(2, "0")}</span>
                      <div className="h-px w-8 bg-gradient-to-r from-brand/50 to-transparent" />
                      <span className="text-[11px] font-brand uppercase tracking-[0.28em] text-brand/90">{p.tag}</span>
                    </div>
                    <h3 className="mt-4 text-balance font-brand text-3xl font-semibold leading-[1.1] tracking-tight text-white sm:text-4xl">
                      {p.title}
                    </h3>
                    <p className="mt-3 text-base leading-relaxed text-white/70 sm:text-lg">{p.body}</p>
                  </div>
                </Reveal>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Final CTA ───────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-3xl px-6 pt-6">
        <Reveal>
        <div className="group/cta relative">
          <div aria-hidden className="pointer-events-none absolute -inset-4 rounded-[1.9rem] bg-brand/12 blur-3xl transition-all duration-500 ease-out group-hover/cta:bg-brand/22" />
          <div className="relative overflow-hidden rounded-2xl border border-brand/25 bg-gradient-to-br from-brand/[0.14] via-white/[0.03] to-brand/[0.1] p-8 text-center transition-[transform,box-shadow,border-color] duration-500 ease-out will-change-transform group-hover/cta:-translate-y-1 group-hover/cta:border-brand/40 group-hover/cta:shadow-[0_42px_92px_-26px_rgba(91,46,162,0.5)] motion-reduce:transition-none motion-reduce:group-hover/cta:translate-y-0 sm:p-10">
            {/* Subtle community footage behind the card — clipped to the rounded
                corners, low-opacity with a heavy violet scrim so the copy stays
                readable. Seamless loop + data-saver/reduced-motion fallback,
                same as the hero. */}
            <AmbientVideo fill src="/videos/cta-ambient.mp4" mobileSrc="/videos/cta-ambient-mobile.mp4" poster="/images/landing/cta-ambient-poster.webp" />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-brand/50 to-transparent" />
            <div className="relative z-10">
            <h2 className="text-balance font-brand text-3xl font-semibold leading-tight text-white sm:text-4xl">
              <span className="text-brand drop-shadow-[0_0_18px_rgba(139,92,246,0.5)]">Own</span> what you make.{" "}
              <span className="text-brand drop-shadow-[0_0_18px_rgba(139,92,246,0.5)]">Take</span> it anywhere.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-white/65">
              Tired of a new username and password for every app? That stops here — 30 seconds to start, no email or phone number needed.
            </p>
            <button
              onClick={onLaunch}
              className="group/btn relative mx-auto mt-7 inline-flex min-h-[48px] items-center gap-2.5 rounded-md border border-white/20 bg-white px-7 py-3 text-black transition-all duration-300 hover:bg-white hover:shadow-[0_0_26px_rgba(139,92,246,0.5)] active:scale-[0.98] active:shadow-[0_0_26px_rgba(139,92,246,0.5)]"
              data-testid="button-launch-cta-final"
            >
              <span
                aria-hidden
                className="launch-glow pointer-events-none absolute -inset-1 -z-10 rounded-md bg-gradient-to-r from-brand/55 via-brand/45 to-brand/55 blur-md transition-all duration-300 group-hover/btn:-inset-2 group-hover/btn:blur-lg group-active/btn:-inset-2 group-active/btn:blur-lg"
              />
              <Rocket className="h-4 w-4 -rotate-45 transition-transform duration-300 group-hover/btn:-translate-y-0.5 group-hover/btn:translate-x-0.5 group-active/btn:-translate-y-0.5 group-active/btn:translate-x-0.5 motion-reduce:group-hover/btn:translate-x-0 motion-reduce:group-hover/btn:translate-y-0" />
              <span className="font-brand text-base font-semibold uppercase tracking-[0.22em]">Get Started</span>
            </button>
            <div className="mt-6 flex items-center justify-center gap-2 text-[11px] font-mono uppercase tracking-[0.28em] text-white/70">
              <Globe className="h-3.5 w-3.5" />
              <span>Free · No lock-in · Works on any modern device</span>
            </div>
            </div>
          </div>
        </div>
        </Reveal>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="mx-auto mt-16 w-full max-w-6xl px-6">
        {/* Brand + nav columns */}
        <Reveal>
        <div className="grid gap-10 border-t border-white/[0.08] pt-12 md:grid-cols-[1.7fr_1fr_1fr] md:gap-12">
          {/* Brand */}
          <div className="max-w-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]">
                <RelayOutpostIcon className="h-5 w-5 text-white/85" />
              </span>
              <span className="font-brand text-sm font-semibold uppercase tracking-[0.2em] text-white">Relay Outpost</span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-white/70">
              Your words, your people, your support — one account you can take anywhere.
            </p>
            <div className="mt-5">
              <PwaAction />
            </div>
          </div>

          {/* Learn */}
          <div>
            <p className="text-[11px] font-brand uppercase tracking-[0.28em] text-white/65">Learn</p>
            <ul className="mt-4 space-y-2.5">
              {[
                { label: "Help & Guides", href: "/help" },
                { label: "Your first 10 minutes", href: "/help/first-10-minutes" },
                { label: "Why it matters", href: "/help/why-decentralization" },
                { label: "How your feed works", href: "/help/wot-vs-algorithms" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[13px] text-white/70 transition-colors hover:text-white" data-testid={`footer-link-${l.href.replace(/\//g, "-")}`}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <p className="text-[11px] font-brand uppercase tracking-[0.28em] text-white/65">Resources</p>
            <ul className="mt-4 space-y-2.5">
              {[
                { label: "Set up your community", href: "/help/setting-up-outpost" },
                { label: "Connect a wallet", href: "/help/connecting-wallet" },
                { label: "Privacy", href: "/privacy" },
                { label: "Terms", href: "/terms" },
              ].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-[13px] text-white/70 transition-colors hover:text-white" data-testid={`footer-link-${l.href.replace(/\//g, "-")}`}>
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] text-white/70 transition-colors hover:text-white"
                  data-testid="footer-link-github"
                >
                  <GitHubMark className="h-3.5 w-3.5" /> GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>

        </Reveal>

        {/* Ecosystem — left-aligned labeled rows */}
        <Reveal delayMs={120}>
        <div className="mt-12 space-y-6 border-t border-white/[0.06] pt-9">
          {/* Apps */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <span className="w-44 shrink-0 text-[11px] font-brand uppercase tracking-[0.26em] text-white/65">Compatible apps</span>
            <div className="flex flex-wrap items-center gap-2.5">
              {ECOSYSTEM_APPS.map((app) => (
                <a
                  key={app.name}
                  href={app.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={app.name}
                  aria-label={app.name}
                  className="group/app inline-flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-1.5 transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.06] motion-reduce:hover:translate-y-0"
                  data-testid={`link-ecosystem-${app.name.toLowerCase()}`}
                >
                  <img src={app.logo} alt={app.name} loading="lazy" decoding="async" className="h-full w-full rounded-md object-contain opacity-70 grayscale-[0.4] transition-all duration-300 group-hover/app:opacity-100 group-hover/app:grayscale-0" />
                </a>
              ))}
            </div>
          </div>

          {/* Relays */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <span className="w-44 shrink-0 text-[11px] font-brand uppercase tracking-[0.26em] text-white/65">Relay software</span>
            <div className="flex flex-wrap items-center gap-2">
              {COMPATIBLE_RELAYS.map((relay) => (
                <a
                  key={relay.name}
                  href={relay.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/relay inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-white/80 transition-colors duration-300 hover:border-brand/30 hover:bg-brand/[0.09] hover:text-white"
                  data-testid={`link-relay-${relay.name.toLowerCase()}`}
                >
                  {relay.name}
                  <ArrowUpRight className="h-3 w-3 opacity-40 transition-opacity duration-300 group-hover/relay:opacity-80" />
                </a>
              ))}
            </div>
          </div>

          {/* Wallets */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <span className="w-44 shrink-0 text-[11px] font-brand uppercase tracking-[0.26em] text-white/65">Compatible wallets</span>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {BITCOIN_WALLETS.map((wallet) => (
                <a
                  key={wallet.name}
                  href={wallet.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={wallet.name}
                  aria-label={wallet.name}
                  className="group/wallet inline-flex items-center transition-transform duration-300 ease-out hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
                  data-testid={`link-wallet-${wallet.name.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <img src={wallet.logo} alt={wallet.name} loading="lazy" decoding="async" style={{ height: `${wallet.h}px`, mixBlendMode: "screen" }} className="w-auto opacity-70 grayscale-[0.25] transition-all duration-300 group-hover/wallet:opacity-100 group-hover/wallet:grayscale-0" />
                </a>
              ))}
            </div>
          </div>
          {/* Built on — the open standards under everything */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <span className="w-44 shrink-0 text-[11px] font-brand uppercase tracking-[0.26em] text-white/65">Built on</span>
            <div className="flex flex-wrap items-center gap-2">
              {BUILT_ON.map((p) => (
                <a
                  key={p.name}
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/proto inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-white/80 transition-colors duration-300 hover:border-brand/30 hover:bg-brand/[0.09] hover:text-white"
                  data-testid={`link-builton-${p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  {p.name}
                  <ArrowUpRight className="h-3 w-3 opacity-40 transition-opacity duration-300 group-hover/proto:opacity-80" />
                </a>
              ))}
            </div>
          </div>

          {/* Broader interop — text chips until logos land */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <span className="w-44 shrink-0 text-[11px] font-brand uppercase tracking-[0.26em] text-white/65">Also works with</span>
            <div className="flex flex-wrap items-center gap-2">
              {ALSO_WORKS_WITH.map((svc) => (
                <a
                  key={svc.name}
                  href={svc.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/svc inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] text-white/80 transition-colors duration-300 hover:border-brand/30 hover:bg-brand/[0.09] hover:text-white"
                  data-testid={`link-workswith-${svc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                >
                  {svc.name}
                  <ArrowUpRight className="h-3 w-3 opacity-40 transition-opacity duration-300 group-hover/svc:opacity-80" />
                </a>
              ))}
            </div>
          </div>
        </div>

        </Reveal>

        {/* Open source — built in the open, with the receipts */}
        <Reveal delayMs={160}>
          <OpenSourcePanel />
        </Reveal>

        {/* Bottom bar */}
        <div className="mt-10 flex flex-col items-center gap-3 border-t border-white/[0.06] py-7 text-[11px] sm:flex-row sm:justify-between">
          <span className="font-mono uppercase tracking-[0.26em] text-white/55">The next phase of the internet</span>
          <span className="text-white/55">© {new Date().getFullYear()} Relay Outpost</span>
        </div>
      </footer>
    </div>
  );
}
