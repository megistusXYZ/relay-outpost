import { Link } from "wouter";
import {
  MessageCircle, Lock, Shield, Key,
  ChevronRight, Image as ImageIcon, Play, Eye,
  EyeOff, Package, Radio, AlertCircle,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";

import { StepCard } from "@/components/wtf/StepCard";

export default function EncryptedMessages() {
  useDocumentTitle("Encrypted Direct Messages — Relay Outpost");

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
            <h1 className="text-lg sm:text-xl font-black uppercase tracking-[0.06em] leading-none text-brand dark:text-brand/90" style={{ fontStyle: "italic" }}>
              Encrypted Direct Messages
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">truly private comms</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            Direct messages here aren't like DMs on other platforms. They're end-to-end encrypted with your own keys — no company can read them, and no server stores them in the clear. Relay Outpost uses NIP-17, the Nostr protocol's strongest DM standard — end-to-end encrypted so only you and the person you're talking to can read a conversation. This guide explains how it works.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <MessageCircle className="w-3.5 h-3.5 text-pink-500/70" />
            <span className="text-[11px] font-medium text-muted-foreground/60">Estimated time: 6 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="How private messages work"
          icon={Key}
          description={
            <>
              <p>Your account has two keys — a <strong>public key</strong> (your identity) and a <strong>secret key</strong> (yours alone). Messages use them like this:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Your message is encrypted with the recipient's public key</li>
                <li>Only the recipient's private key can decrypt it</li>
                <li>Relays only store the scrambled message — they can't read it</li>
                <li>Even if a relay is compromised, your messages remain private</li>
              </ul>
              <p className="text-[12px] text-foreground/50">It's the same idea Signal and other secure messengers use — except here, you own the keys, not a company.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="How your messages stay sealed"
          icon={Package}
          description={
            <>
              <p>Relay Outpost seals each message in a private envelope. Here's what that protects:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-brand font-bold text-xs">Hidden Metadata</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">The envelope is sent under a random throwaway key, so relay operators can't see who sent it. An observer can see that someone received an encrypted message — but not who sent it or what it says.</p>
                </div>
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-brand font-bold text-xs">Encrypted Content</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">The actual message is encrypted inside the envelope using strong, modern encryption.</p>
                </div>
                <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-brand font-bold text-xs">Self-Copy</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Relay Outpost sends a sealed copy back to you so you can see your sent messages across devices — without exposing them to anyone else.</p>
                </div>
              </div>
            </>
          }
        />

        <StepCard
          number={3}
          title="Sending Your First DM"
          icon={MessageCircle}
          description={
            <>
              <p>Sending a private message in Relay Outpost is straightforward:</p>
              <ol className="list-decimal list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Navigate to <strong>Chats</strong> in the sidebar</li>
                <li>Start a new conversation by searching for a user</li>
                <li>Type your message and send — it's encrypted automatically</li>
                <li>Your signer (extension or key) handles the encryption behind the scenes</li>
              </ol>
              <div className="rounded-lg bg-muted/10 dark:bg-white/[0.03] border border-border/20 px-3 py-2 mt-2">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-brand/60 shrink-0" />
                  <p className="text-[12px] text-foreground/60">Your signer app needs to support modern encryption. Apps like Alby and nos2x do — if yours doesn't, you'll see a helpful message.</p>
                </div>
              </div>
            </>
          }
        />

        <StepCard
          number={4}
          title="Reading & Managing Conversations"
          icon={Eye}
          description={
            <>
              <p>The <strong>Chats</strong> list holds every conversation — private messages alongside your group rooms and communities:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Sections for <strong>People</strong>, <strong>Groups</strong>, and <strong>Communities</strong>, with filter chips to jump between them</li>
                <li>Messages from people outside your circle wait in <strong>Requests</strong> at the top of People — nothing from a stranger lands in your main list unasked</li>
                <li>Messages are decrypted locally using your key — they never leave your device in plaintext</li>
                <li>Profile pictures and display names are shown alongside conversations</li>
                <li>Your sent messages appear on your side (thanks to the sealed self-copy)</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Messages are cached locally for performance, but the source of truth is always the encrypted events on your relays.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Privacy Guarantees"
          icon={Shield}
          description={
            <>
              <p>Here's exactly what's protected and what's visible:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-lg bg-emerald-500/[0.05] dark:bg-emerald-500/[0.03] border border-emerald-500/15 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <EyeOff className="w-3 h-3 text-emerald-500/60" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">Hidden from relays</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Message content, sender identity, conversation thread, and timestamps of the inner message.</p>
                </div>
                <div className="rounded-lg bg-amber-500/[0.05] dark:bg-amber-500/[0.03] border border-amber-500/15 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Eye className="w-3 h-3 text-amber-500/60" />
                    <span className="text-amber-600 dark:text-amber-400 font-bold text-[11px]">Visible to relays</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">That an encrypted message exists, and who received it (but not its content or who sent it). The throwaway key used for the envelope (not the sender's real identity). The relay it was published to.</p>
                </div>
              </div>
              <p className="text-[12px] text-foreground/50 mt-2">In practice, an observer can see that encrypted traffic exists, but can't determine who is talking to whom or what they're saying.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Which Relays Store Your DMs?"
          icon={Radio}
          description={
            <>
              <p>Sealed messages are published to relays so the recipient can pick them up:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>DMs are sent to the recipient's preferred relays (from their relay list)</li>
                <li>A self-copy goes to your own relays so you can access sent messages</li>
                <li>Some dedicated DM relays exist that specialize in private message storage</li>
                <li>You control which relays you use — you can add or remove relay connections anytime</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Since messages are end-to-end encrypted, even a hostile relay operator gains nothing from storing your DMs — they're just encrypted blobs.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-gradient-to-br from-pink-500/[0.03] to-brand/[0.02] p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-pink-500/15 to-brand/10 border border-pink-500/15 flex items-center justify-center mx-auto mb-3">
            <Lock className="w-6 h-6 text-pink-500/60" />
          </div>
          <h3 className="text-sm font-bold text-foreground/80 mb-1">Your conversations are yours</h3>
          <p className="text-xs text-muted-foreground/50 max-w-sm mx-auto leading-relaxed mb-4">
            No company reads your DMs. No AI scans them for ads. There is no server-side copy of your messages for anyone to request — only you and your recipient hold the keys.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/messages" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-pink-500/10 text-pink-600 dark:text-pink-400 border border-pink-500/20 text-xs font-medium transition-all duration-200 hover:bg-pink-500/15">
              Open Chats
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link href="/help" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-muted/20 text-muted-foreground/70 border border-border/20 text-xs font-medium transition-all duration-200 hover:bg-muted/30">
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
