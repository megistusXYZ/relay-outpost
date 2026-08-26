import { Link } from "wouter";
import {
  Zap, Wallet, QrCode, Copy, Unplug,
  ChevronRight, Image as ImageIcon, Play, Shield,
  ExternalLink, AlertCircle, Settings, Send,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";
import { BtcZapIcon } from "@/components/NostrPost";

import { StepCard } from "@/components/wtf/StepCard";

function WalletProviderCard({ name, url, description }: { name: string; url: string; description: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group rounded-lg border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 hover:border-brand/20 p-3 transition-all duration-300 hover:shadow-[0_2px_12px_rgba(139,92,246,0.06)]"
    >
      <div className="flex items-center gap-2 mb-1">
        <BtcZapIcon className="w-3.5 h-3.5 text-[#F7931A]" />
        <span className="text-xs font-semibold text-foreground/80">{name}</span>
        <ExternalLink className="w-2.5 h-2.5 text-muted-foreground/30 group-hover:text-brand/50 transition-colors ml-auto" />
      </div>
      <p className="text-[10px] text-muted-foreground/50 leading-relaxed">{description}</p>
    </a>
  );
}

export default function ConnectingWallet() {
  useDocumentTitle("Connecting a Lightning Wallet — Relay Outpost");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-300">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <div className="relative shrink-0 -rotate-[10deg]">
            <WtfAlienIcon className="w-9 h-9 text-brand drop-shadow-[0_0_10px_rgba(109,40,217,0.4)] dark:drop-shadow-[0_0_12px_rgba(139,92,246,0.45)]" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-brand shadow-[0_0_6px_rgba(109,40,217,0.5)]" />
          </div>
          <div>
            <h1
              className="text-lg sm:text-xl font-black uppercase tracking-[0.06em] leading-none text-brand dark:text-brand/90"
              style={{ fontStyle: "italic" }}
            >
              Connecting a Lightning Wallet
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">send sats, send signal</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            Zaps are small, optional Bitcoin tips — a way to send someone real appreciation. To send and receive them, you need a Bitcoin (Lightning) wallet that can connect to apps. This guide walks you through choosing a wallet, connecting it, adding a tipping address to your profile, and sending your first zap.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <BtcZapIcon className="w-3.5 h-3.5 text-[#F7931A]" />
            <span className="text-[11px] font-medium text-muted-foreground/60">Estimated time: 5 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Choose a Lightning Wallet"
          icon={Wallet}
          description={
            <>
              <p>Before connecting to Relay Outpost, you need a Lightning wallet that can connect to other apps (sometimes called "Wallet Connect"). Here are some popular options:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                <WalletProviderCard
                  name="Alby"
                  url="https://getalby.com"
                  description="Browser extension + hub. Great for desktop Nostr users."
                />
                <WalletProviderCard
                  name="Coinos"
                  url="https://coinos.io"
                  description="Web-based wallet with instant setup. No install needed."
                />
                <WalletProviderCard
                  name="LNbits"
                  url="https://lnbits.com"
                  description="Self-hosted Lightning toolkit you can run yourself."
                />
                {/* Mutiny retired here after it shut down — a pilot tester
                    caught us still recommending it (2026-08). */}
                <WalletProviderCard
                  name="Zeus"
                  url="https://zeusln.com"
                  description="Self-custodial mobile Lightning wallet with wallet-connect."
                />
              </div>
              <p className="text-[12px] text-foreground/50">Any wallet with an app-connect feature will work. Your wallet keys never leave your wallet — Relay Outpost only sends payment requests, over an encrypted connection.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Get Your Wallet Connection Code"
          icon={Copy}
          description={
            <>
              <p>Inside your wallet app, you'll need to generate a connection code. The exact steps vary by wallet, but the general flow is:</p>
              <ol className="list-decimal list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Open your Lightning wallet app or website</li>
                <li>Find <strong>"Connect an app"</strong> (sometimes "Wallet Connect") in the settings</li>
                <li>Create a new connection (sometimes called "app connection")</li>
                <li>Copy the connection URI — it starts with <code className="text-[11px] bg-muted/30 px-1 py-0.5 rounded font-mono">nostr+walletconnect://</code></li>
              </ol>
              <p className="text-[12px] text-foreground/50">Some wallets also offer a QR code you can scan. The connection string is a one-time link that securely pairs your wallet with Relay Outpost.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="Connect in Relay Outpost"
          icon={Unplug}
          description={
            <>
              <p>Now open the <strong>You</strong> tab (your avatar, bottom right) → <strong>Wallet</strong> and paste your connection string:</p>
              <ol className="list-decimal list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Navigate to the <strong>Lightning Wallet</strong> page</li>
                <li>Paste your connection code into the field</li>
                <li>Tap <strong>Connect Wallet</strong></li>
                <li>Your balance should appear within a few seconds</li>
              </ol>

              <p className="text-[12px] text-foreground/50">Once connected, you'll see your balance, transaction history, and the ability to send and receive sats directly from Relay Outpost.</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="Set Your Lightning Address"
          icon={Settings}
          description={
            <>
              <p>A Lightning address is like an email address for receiving Bitcoin. Zaps go to the address on your <em>profile</em> — and there are two ways to get one:</p>
              <ol className="list-decimal list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>No wallet yet?</strong> On the Wallet page, tap <strong>Use npub.cash address</strong> — you're zappable instantly, and the same page shows what's waiting and lets you claim it later</li>
                <li><strong>Have a wallet with an address?</strong> Open the <strong>You</strong> tab → <strong>Edit profile</strong> and enter it (e.g., <code className="text-[11px] bg-muted/30 px-1 py-0.5 rounded font-mono">you@getalby.com</code>)</li>
                <li>Save — this publishes it to your relays</li>
              </ol>
              <p className="text-[12px] text-foreground/50">Zaps land at your profile's address, not the connected wallet — the Wallet page tells you when sats are waiting at npub.cash and can sweep them to a wallet you control.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Send Your First Zap"
          icon={Zap}
          description={
            <>
              <p>Now the fun part — sending an optional tip to someone you appreciate:</p>
              <ol className="list-decimal list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Find a post you like in your feed</li>
                <li>Tap the <strong>zap icon</strong> (lightning bolt) on the post</li>
                <li>Choose an amount — you can use presets or type a custom amount</li>
                <li>Confirm and send — the zap is instant</li>
              </ol>
              <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2 mt-2">
                <div className="flex items-center gap-2">
                  <BtcZapIcon className="w-3.5 h-3.5 text-[#F7931A] shrink-0" />
                  <p className="text-[12px] text-foreground/60">You can customize your zap presets and default amount in the Wallet settings. Set quick-tap amounts that work for your budget.</p>
                </div>
              </div>
              <p className="text-[12px] text-foreground/50">Zaps are recorded on Nostr relays, so everyone can see the value flowing through the network. It's the economic engine of the open internet.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Send Sats Directly"
          icon={Send}
          description={
            <>
              <p>Beyond zapping posts, you can also send sats directly to any Nostr user or Lightning address from the Wallet page:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Search for a person by name</li>
                <li>Enter a Lightning address or invoice</li>
                <li>Set the amount and add an optional message</li>
                <li>Send — it arrives instantly</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Your wallet page shows your full transaction history — every zap sent and received, organized by date with enriched profile data.</p>
            </>
          }
        />

        <StepCard
          number={7}
          title="Security & Privacy"
          icon={Shield}
          description={
            <>
              <p>How this keeps your funds secure:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>Your keys stay with your wallet</strong> — Relay Outpost never has access to your private keys or seed phrase</li>
                <li><strong>Encrypted communication</strong> — All wallet commands travel over an encrypted connection</li>
                <li><strong>Revoke anytime</strong> — You can disconnect your wallet or revoke the connection from your wallet provider at any time</li>
                <li><strong>Spending limits</strong> — Some wallets let you set a spending limit on the connection for extra safety</li>
              </ul>
              <p className="text-[12px] text-foreground/50">It's designed so that even if someone intercepted the connection code, they couldn't access your funds without your wallet's approval.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-gradient-to-br from-[#F7931A]/[0.03] to-brand/[0.02] p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#F7931A]/15 to-brand/10 border border-[#F7931A]/15 flex items-center justify-center mx-auto mb-3">
            <BtcZapIcon className="w-6 h-6 text-[#F7931A]/60" />
          </div>
          <h3 className="text-sm font-bold text-foreground/80 mb-1">You're ready to zap</h3>
          <p className="text-xs text-muted-foreground/50 max-w-sm mx-auto leading-relaxed mb-4">
            With your wallet connected, you're now part of the value-for-value economy. Every zap goes directly from one person to another — Relay Outpost never touches it and never takes a cut. Just people supporting people.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/wallet"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#F7931A]/10 text-[#F7931A] border border-[#F7931A]/20 text-xs font-medium transition-all duration-200 hover:bg-[#F7931A]/15"
            >
              Open Wallet
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/help"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted/20 text-muted-foreground/70 border border-border/20 text-xs font-medium transition-all duration-200 hover:bg-muted/30"
            >
              Back to Help &amp; Guides
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-black/[0.06] dark:border-white/[0.04] mt-3 pt-4 pb-2 text-center">
        <p className="text-[10px] text-muted-foreground/30 font-medium uppercase tracking-wider">
          Relay Outpost — The Next Phase of the Internet
        </p>
      </div>
    </div>
  );
}
