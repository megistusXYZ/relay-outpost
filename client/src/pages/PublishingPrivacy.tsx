import { publicPageTitle } from "@shared/public-pages";
import { Link } from "wouter";
import {
  Lock,
  Image as ImageIcon,
  Shield,
  ChevronRight,
  Camera,
  Eye,
  EyeOff,
  Radio,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { OttoMark } from "@/components/OttoMark";

import { StepCard } from "@/components/wtf/StepCard";

export default function PublishingPrivacy() {
  useDocumentTitle(publicPageTitle("/help/publishing-privacy"));

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-150">
      <div className="flex items-center gap-3 mb-1">
        {/* Chrome back owns the route (back-affordance.ts) — no hero dupe. */}
        <div className="flex items-center gap-2">
          <OttoMark size={40} label="Relay" className="shrink-0 text-foreground !w-9 !h-9 sm:!w-10 sm:!h-10" />
          <div>
            <h1 className="text-[24px] sm:text-[30px] font-semibold tracking-[-0.025em] leading-[1.1] text-foreground">
              Publishing & privacy
            </h1>
            <p className="text-[14px] sm:text-[15px] text-muted-foreground mt-1">Privacy-first publishing</p>
          </div>
        </div>
      </div>

      <div className="mb-8">
        <div className="rounded-[20px] border border-border/60 bg-card p-5">
          <p className="text-[15px] text-foreground/75 leading-relaxed">
            When you publish on most platforms, you're leaking data you don't even know about — GPS coordinates buried in photos, device details, and posts that can be scraped without your consent. Relay Outpost is built to protect you. This guide covers how hidden photo data is removed, where your posts get sent, and how your content stays under your control.
          </p>
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/20">
            <Lock className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[12px] font-medium text-muted-foreground">Estimated time: 6 minutes</span>
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
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 text-danger" />
                    <span className="text-danger font-semibold text-[13px]">What hidden photo data can expose</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">GPS coordinates (your exact location), device model, camera settings, date and time, and sometimes even your name or software used.</p>
                </div>
                <div className="rounded-[16px] bg-foreground/[0.03] border border-border/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-3 h-3 text-success" />
                    <span className="text-success font-semibold text-[13px]">What Relay Outpost does</span>
                  </div>
                  <p className="text-[12px] text-foreground/60 mt-0.5">Automatically strips hidden data from JPEG, PNG, WebP, and BMP photos before uploading — no GPS, no device info, nothing extra. Other formats (like GIF or SVG) upload as-is.</p>
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">This happens automatically for photos — no toggle, no setting. Privacy by default.</p>
            </>
          }
        />

        <StepCard
          number={2}
          title="Audio metadata stripping"
          icon={FileText}
          description={
            <>
              <p>It's not just images — audio files can contain metadata too. Relay Outpost handles this for audio uploads:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>Audio files</strong> — hidden tags are stripped (artist name, album, software, comments)</li>
                <li><strong>WAV files</strong> — Metadata chunks are removed, keeping only the audio data</li>
                <li><strong>FLAC files</strong> — Vorbis comments and metadata blocks are stripped</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">When you upload audio content, Relay Outpost removes identifying metadata — tags, comments, embedded software info — before it leaves your device.</p>
            </>
          }
        />

        <StepCard
          number={3}
          title="Relay selection strategy"
          icon={Radio}
          description={
            <>
              <p>Where you publish matters. Your relay choices determine who can access your content and where it's stored:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>Public relays</strong> — Maximum reach, but anyone can read your posts</li>
                <li><strong>Private/paid relays</strong> — Restricted access, higher signal-to-noise ratio</li>
                <li><strong>Community relays</strong> — Community-specific, posts stay within the group</li>
                <li><strong>Your own relay</strong> — Complete control, you manage all access</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">You can configure read/write settings per relay — posting widely while reading selectively, or vice versa.</p>
            </>
          }
        />

        <StepCard
          number={4}
          title="Choosing what you publish"
          icon={Eye}
          description={
            <>
              <p>Every post on Nostr is signed with your key and published to your relays. Understanding what's public helps you make informed choices:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>Posts</strong> — Public on the relays you publish to. Anyone connected to those relays can see them.</li>
                <li><strong>DMs</strong> — Sealed and end-to-end encrypted. Content is hidden even from relay operators.</li>
                <li><strong>Profile data</strong> — Your name, bio, picture, and Lightning address are public by design.</li>
                <li><strong>Follow list</strong> — Your follow list is public. People can see who you follow.</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">There's no "private account" on Nostr — instead, you control distribution through relay selection and encryption.</p>
            </>
          }
        />

        <StepCard
          number={5}
          title="Content sensitivity controls"
          icon={EyeOff}
          description={
            <>
              <p>Relay Outpost respects content warnings wherever they travel:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li>Posts labelled sensitive arrive blurred — tap to reveal, on your terms</li>
                <li>Configure how sensitive content from others appears in your feed</li>
                <li>Content warnings travel with the post wherever it goes</li>
                <li>Your preferences are saved to your encrypted settings and sync across your devices</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Sensitivity settings are personal — they affect what you see, not what others can post.</p>
            </>
          }
        />

        <StepCard
          number={6}
          title="Image loading controls"
          icon={ImageIcon}
          description={
            <>
              <p>Loading external images can reveal your IP address to the server hosting them. Relay Outpost gives you control:</p>
              <ul className="list-disc list-inside space-y-1 text-[14px] text-foreground/70">
                <li><strong>Show immediately</strong> — Images load automatically (convenient, but reveals your IP to image hosts)</li>
                <li><strong>Blur until tapped</strong> — Images stay blurred until you choose to load each one</li>
              </ul>
              <p className="text-[12px] text-muted-foreground">Flip <strong>Blur images until tapped</strong> anytime in Settings. It's a trade-off between convenience and privacy — you choose where you land.</p>
            </>
          }
        />
      </div>

      <div className="mt-10 mb-6">
        <div className="rounded-[20px] border border-border/60 bg-card p-6 text-center">
          <div className="w-12 h-12 rounded-full dark:bg-foreground/[0.05] flex items-center justify-center mx-auto mb-3">
            <Shield className="w-6 h-6 text-foreground/75" />
          </div>
          <h3 className="text-[17px] font-semibold text-foreground mb-1">Publish with confidence</h3>
          <p className="text-[14px] text-muted-foreground max-w-sm mx-auto leading-relaxed mb-5">
            Relay Outpost strips metadata, encrypts what should be private, and gives you full control over where your content lives. Your data, your rules.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link href="/settings" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap bg-foreground text-background text-[15px] font-medium hover:bg-foreground/90 active:scale-[0.98] transition-colors duration-150">
              Privacy settings
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
            <Link href="/help" className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full whitespace-nowrap border border-foreground/25 text-foreground text-[15px] font-medium hover:bg-foreground/[0.06] active:scale-[0.98] transition">
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
