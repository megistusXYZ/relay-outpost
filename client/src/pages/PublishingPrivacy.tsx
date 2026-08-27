import { Link } from "wouter";
import {
  Lock, Image as ImageIcon, Play, Shield,
  ChevronRight, Camera, Eye, EyeOff, Radio,
  FileText, MapPin, AlertTriangle,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { WtfAlienIcon } from "@/components/icons/WtfAlienIcon";

import { StepCard } from "@/components/wtf/StepCard";

export default function PublishingPrivacy() {
  useDocumentTitle("Publishing & Privacy — Relay Outpost");

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
              Publishing & Privacy
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">privacy-first publishing</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
          <p className="text-sm text-foreground/70 dark:text-muted-foreground leading-relaxed">
            When you publish on most platforms, you're leaking data you don't even know about — GPS coordinates buried in photos, device details, and posts that can be scraped without your consent. Relay Outpost is built to protect you. This guide covers how hidden photo data is removed, where your posts get sent, and how your content stays under your control.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Lock className="w-3.5 h-3.5 text-red-500/70" />
            <span className="text-[11px] font-medium text-muted-foreground/60">Estimated time: 6 minutes</span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <StepCard
          number={1}
          title="Hidden photo data, removed automatically"
          icon={Camera}
          description={
            <>
              <p>Every photo you take with your phone carries hidden data — and it can reveal more than you'd expect:</p>
              <div className="space-y-1.5 mt-2">
                <div className="rounded-lg bg-red-500/[0.05] dark:bg-red-500/[0.03] border border-red-500/15 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-red-500/60" />
                    <span className="text-red-600 dark:text-red-400 font-bold text-[11px]">What hidden photo data can expose</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">GPS coordinates (your exact location), device model, camera settings, date and time, and sometimes even your name or software used.</p>
                </div>
                <div className="rounded-lg bg-emerald-500/[0.05] dark:bg-emerald-500/[0.03] border border-emerald-500/15 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-3 h-3 text-emerald-500/60" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">What Relay Outpost does</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Automatically strips hidden data from JPEG, PNG, WebP, and BMP photos before uploading — no GPS, no device info, nothing extra. Other formats (like GIF or SVG) upload as-is.</p>
                </div>
              </div>
              <p className="text-[12px] text-foreground/50">This happens automatically for photos — no toggle, no setting. Privacy by default.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Audio Metadata Stripping"
          icon={FileText}
          description={
            <>
              <p>It's not just images — audio files can contain metadata too. Relay Outpost handles this for audio uploads:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>Audio files</strong> — hidden tags are stripped (artist name, album, software, comments)</li>
                <li><strong>WAV files</strong> — Metadata chunks are removed, keeping only the audio data</li>
                <li><strong>FLAC files</strong> — Vorbis comments and metadata blocks are stripped</li>
              </ul>
              <p className="text-[12px] text-foreground/50">When you upload audio content, Relay Outpost removes identifying metadata — tags, comments, embedded software info — before it leaves your device.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="Relay Selection Strategy"
          icon={Radio}
          description={
            <>
              <p>Where you publish matters. Your relay choices determine who can access your content and where it's stored:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>Public relays</strong> — Maximum reach, but anyone can read your posts</li>
                <li><strong>Private/paid relays</strong> — Restricted access, higher signal-to-noise ratio</li>
                <li><strong>Community relays</strong> — Community-specific, posts stay within the group</li>
                <li><strong>Your own relay</strong> — Complete control, you manage all access</li>
              </ul>
              <p className="text-[12px] text-foreground/50">You can configure read/write settings per relay — broadcasting widely while reading selectively, or vice versa.</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="Choosing What You Publish"
          icon={Eye}
          description={
            <>
              <p>Every post on Nostr is signed with your key and published to your relays. Understanding what's public helps you make informed choices:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>Notes</strong> — Public on the relays you publish to. Anyone connected to those relays can see them.</li>
                <li><strong>DMs</strong> — Sealed and end-to-end encrypted. Content is hidden even from relay operators.</li>
                <li><strong>Profile data</strong> — Your name, bio, picture, and Lightning address are public by design.</li>
                <li><strong>Follow list</strong> — Your follow list is public. People can see who you follow.</li>
              </ul>
              <p className="text-[12px] text-foreground/50">There's no "private account" on Nostr — instead, you control distribution through relay selection and encryption.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Content Sensitivity Controls"
          icon={EyeOff}
          description={
            <>
              <p>Relay Outpost respects content warnings wherever they travel:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li>Posts labelled sensitive arrive blurred — tap to reveal, on your terms</li>
                <li>Configure how sensitive content from others appears in your feed</li>
                <li>Content warnings travel with the post wherever it goes</li>
                <li>Your preferences are saved to your encrypted settings and sync across your devices</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Sensitivity settings are personal — they affect what you see, not what others can post.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Image Loading Controls"
          icon={ImageIcon}
          description={
            <>
              <p>Loading external images can reveal your IP address to the server hosting them. Relay Outpost gives you control:</p>
              <ul className="list-disc list-inside space-y-1 text-[13px] text-foreground/60">
                <li><strong>Show immediately</strong> — Images load automatically (convenient, but reveals your IP to image hosts)</li>
                <li><strong>Blur until tapped</strong> — Images stay blurred until you choose to load each one</li>
              </ul>
              <p className="text-[12px] text-foreground/50">Flip <strong>Blur images until tapped</strong> anytime in Settings. It's a trade-off between convenience and privacy — you choose where you land.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-xl border border-border/30 dark:border-border/15 bg-gradient-to-br from-red-500/[0.03] to-brand/[0.02] p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500/15 to-brand/10 border border-red-500/15 flex items-center justify-center mx-auto mb-3">
            <Shield className="w-6 h-6 text-red-500/60" />
          </div>
          <h3 className="text-sm font-bold text-foreground/80 mb-1">Publish with confidence</h3>
          <p className="text-xs text-muted-foreground/50 max-w-sm mx-auto leading-relaxed mb-4">
            Relay Outpost strips metadata, encrypts what should be private, and gives you full control over where your content lives. Your data, your rules.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link href="/settings" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-xs font-medium transition-all duration-200 hover:bg-red-500/15">
              Privacy Settings
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
