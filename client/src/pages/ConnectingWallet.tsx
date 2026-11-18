import { Link } from "wouter";
import {
  Zap,
  Wallet,
  Copy,
  Unplug,
  ChevronRight,
  Shield,
  ExternalLink,
  Settings,
  Send,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";
import { BtcZapIcon } from "@/components/NostrPost";

import { StepCard } from "@/components/wtf/StepCard";

function WalletProviderCard({ name, url, description }: { name: string; url: string; description: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group rounded-[16px] border border-border/60 bg-card hover:border-border p-3 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        <BtcZapIcon className="w-3.5 h-3.5 text-[#F7931A]" />
        <span className="text-xs font-semibold text-foreground/80">{name}</span>
        <ExternalLink className="w-2.5 h-2.5 text-muted-foreground group-hover:text-foreground/60 transition-colors ml-auto" />
      </div>
      <p className="text-[12px] text-muted-foreground leading-relaxed">{description}</p>
    </a>
  );
}

export default function ConnectingWallet() {
  useDocumentTitle("Connecting a Lightning wallet — Relay Outpost");

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Otto" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1
              className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground"
            >
              Connecting a Lightning wallet
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">Send sats, send support</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            Zaps are small, optional Bitcoin tips — a way to send someone real appreciation. To send and receive them, you need a Bitcoin (Lightning) wallet that can connect to apps. This guide walks you through choosing a wallet, connecting it, adding a tipping address to your profile, and sending your first zap.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <BtcZapIcon className="w-3.5 h-3.5 text-[#F7931A]" />
            <span className="text-[12px] font-medium text-muted-foreground">Estimated time: 5 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Choose a Lightning wallet"
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
              <p className="text-[12px] text-muted-foreground">Any wallet with an app-connect feature will work. Your wallet keys never leave your wallet — Relay Outpost only sends payment requests, over an encrypted connection.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Get your wallet connection code"
          icon={Copy}
          description={
            <>
              <p>Inside your wallet app, you'll need to generate a connection code. The exact steps vary by wallet, but the general flow is:</p>
              <ol className="list-decimal list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Open your Lightning wallet app or website</li>
                <li>Find <strong>"Connect an app"</strong> (sometimes "Wallet Connect") in the settings</li>
                <li>Create a new connection (sometimes called "app connection")</li>
                <li>Copy the connection URI — it starts with <code className="text-[12px] bg-muted/30 px-1 py-0.5 rounded font-mono">nostr+walletconnect://</code></li>
              </ol>
              <p className="text-[12px] text-muted-foreground">Some wallets also offer a QR code you can scan. The connection string is a one-time link that securely pairs your wallet with Relay Outpost.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="Connect in Relay Outpost"
          icon={Unplug}
          description={
            <>
              <p>Now open the <strong>account</strong> page (your face, at the bottom of the bar) → <strong>Wallet</strong> and paste your connection string:</p>
              <ol className="list-decimal list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Navigate to the <strong>Lightning Wallet</strong> page</li>
                <li>Paste your connection code into the field</li>
                <li>Tap <strong>Connect Wallet</strong></li>
                <li>Your balance should appear within a few seconds</li>
              </ol>

              <p className="text-[12px] text-muted-foreground">Once connected, you'll see your balance, transaction history, and the ability to send and receive sats directly from Relay Outpost.</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="Set your Lightning address"
          icon={Settings}
          description={
            <>
              <p>A Lightning address is like an email address for receiving Bitcoin. Zaps go to the address on your <em>profile</em> — and there are two ways to get one:</p>
              <ol className="list-decimal list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>No wallet yet?</strong> On the Wallet page, tap <strong>Use npub.cash address</strong> — you're zappable instantly, and the same page shows what's waiting and lets you claim it later</li>
                <li><strong>Have a wallet with an address?</strong> Open the <strong>Account</strong> page → <strong>Edit profile</strong> and enter it (e.g., <code className="text-[12px] bg-muted/30 px-1 py-0.5 rounded font-mono">you@getalby.com</code>)</li>
                <li>Save — this publishes it to your relays</li>
              </ol>
              <p className="text-[12px] text-muted-foreground">Zaps land at your profile's address, not the connected wallet — the Wallet page tells you when sats are waiting at npub.cash and can sweep them to a wallet you control.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Send your first zap"
          icon={Zap}
          description={
            <>
              <p>Now the fun part — sending an optional tip to someone you appreciate:</p>
              <ol className="list-decimal list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Find a post you like in your feed</li>
                <li>Tap the <strong>zap icon</strong> (lightning bolt) on the post</li>
                <li>Choose an amount — you can use presets or type a custom amount</li>
                <li>Confirm and send — the zap is instant</li>
              </ol>
              <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2 mt-2">
                <div className="flex items-center gap-2">
                  <BtcZapIcon className="w-3.5 h-3.5 text-[#F7931A] shrink-0" />
                  <p className="text-[12px] text-foreground/60">You can customize your zap presets and default amount in the Wallet settings. Set quick-tap amounts that work for your budget.</p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">Zaps are recorded on Nostr relays, so everyone can see the value flowing through the network. It's the economic engine of the open internet.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Send sats directly"
          icon={Send}
          description={
            <>
              <p>Beyond zapping posts, you can also send sats directly to any Nostr user or Lightning address from the Wallet page:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Search for a person by name</li>
                <li>Enter a Lightning address or invoice</li>
                <li>Set the amount and add an optional message</li>
                <li>Send — it arrives instantly</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Your wallet page shows your full transaction history — every zap sent and received, organized by date with enriched profile data.</p>
            </>
          }
        />

        <StepCard
          number={7}
          title="Security & privacy"
          icon={Shield}
          description={
            <>
              <p>How this keeps your funds secure:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>Your keys stay with your wallet</strong> — Relay Outpost never has access to your private keys or seed phrase</li>
                <li><strong>Encrypted communication</strong> — All wallet commands travel over an encrypted connection</li>
                <li><strong>Revoke anytime</strong> — You can disconnect your wallet or revoke the connection from your wallet provider at any time</li>
                <li><strong>Spending limits</strong> — Some wallets let you set a spending limit on the connection for extra safety</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">It's designed so that even if someone intercepted the connection code, they couldn't access your funds without your wallet's approval.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <BtcZapIcon className="w-6 h-6 text-foreground/75" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">You're ready to zap</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            With your wallet connected, you're now part of the value-for-value economy. Every zap goes directly from one person to another — Relay Outpost never touches it and never takes a cut. Just people supporting people.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/wallet"
              className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition"
            >
              Open Wallet
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link
              href="/help"
              className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap border border-foreground/25 text-foreground text-[15px] font-medium hover:bg-foreground/[0.06] active:scale-[0.98] transition"
            >
              Back to Help &amp; guides
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-border/60 mt-3 pt-4 pb-2 text-center">
        <p className="text-[13px] text-muted-foreground font-medium">
          Relay Outpost — the next phase of the internet
        </p>
      </div>
    </div>
  );
}
