import { Link } from "wouter";
import { ArrowLeft, Compass, Key, Radio, AlertTriangle, Scale, FileText, Users, FlaskConical } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useGoBack } from "@/hooks/use-go-back";

const LAST_UPDATED = "June 15, 2026";

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/30 dark:border-border/15 bg-white/60 dark:bg-muted/10 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand/10 to-brand/10 border border-brand/10 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-brand" />
        </div>
        <h2 className="text-sm font-bold text-foreground/90 uppercase tracking-wider">{title}</h2>
      </div>
      <div className="text-[13px] text-foreground/80 dark:text-foreground/75 leading-relaxed space-y-2">
        {children}
      </div>
    </section>
  );
}

export default function Covenant() {
  useDocumentTitle("Terms — Relay Outpost");
  const goBack = useGoBack();

  return (
    <div className="h-dvh overflow-y-auto">
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 animate-in fade-in duration-300" data-testid="page-covenant">
      <div className="flex items-center gap-3 mb-1">
        <button type="button" onClick={() => goBack("/")} className="text-muted-foreground/50 hover:text-foreground transition-colors" data-testid="link-back-covenant" aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <Compass className="w-7 h-7 text-brand dark:text-brand/80" />
          <div>
            <h1 className="text-lg sm:text-xl font-black uppercase tracking-[0.06em] leading-none text-brand dark:text-brand/90" style={{ fontStyle: "italic" }}>
              Terms
            </h1>
            <p className="text-[10px] text-brand/40 dark:text-brand/30 font-bold uppercase tracking-[0.2em] mt-0.5 ml-0.5">
              the short version of the deal
            </p>
          </div>
        </div>
      </div>

      {/* Public-beta notice. */}
      <div className="mt-6 rounded-xl border border-amber-500/30 dark:border-amber-500/20 bg-amber-500/[0.06] p-4 flex items-start gap-3">
        <FlaskConical className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[13px] text-foreground/80 dark:text-foreground/75 leading-relaxed">
          <strong>Public beta.</strong> Relay Outpost is early software. Things may change, break, or be removed while we build. Use it with that in mind, and keep a backup of your key.
        </p>
      </div>

      <div className="mt-4 mb-6 rounded-xl border border-border/30 dark:border-border/15 bg-white/50 dark:bg-muted/10 p-5">
        <p className="text-sm text-foreground/85 dark:text-foreground/80 leading-relaxed">
          These are the terms for using Relay Outpost, written plainly. They're short because Relay Outpost is a thin client onto the Nostr network — a window, not a walled platform. The one thing to take away sits right at the top: <strong>your keys are yours, and we can't recover them.</strong>
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-3 pt-3 border-t border-border/20">
          Last updated {LAST_UPDATED} · Using Relay Outpost means you accept these terms
        </p>
      </div>

      {/* At a glance. */}
      <div className="mb-6 rounded-xl border border-brand/20 dark:border-brand/12 bg-brand/[0.04] p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand/80 dark:text-brand/70 mb-3">At a glance</p>
        <ul className="space-y-2 text-[13px] text-foreground/85 dark:text-foreground/80">
          {[
            "Your key is yours — there's no password reset, so back it up.",
            "You're responsible for what you publish.",
            "The app is provided as-is, and it's in beta.",
            "Relays and other services are run by third parties, under their own rules.",
          ].map((line) => (
            <li key={line} className="flex items-start gap-2">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-brand shrink-0" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        <Section icon={Compass} title="What Relay Outpost is">
          <p>Relay Outpost is a Nostr client. It hands the events you publish to your signer to be signed, then sends the signed result to the relays you pick. We don't host your posts, decide what gets seen, or control who can read what — the relays and the people on the other end do.</p>
          <p>Nostr itself is a public protocol run by an open network of independent relays. Relay Outpost is one way to use it — not the only way, and never the final word.</p>
        </Section>

        <Section icon={Key} title="Your key, your account">
          <ul className="list-disc list-inside space-y-1.5">
            <li><strong>You are the sole custodian of your key.</strong> Whether it's stored locally in this browser, in a signer extension, or held by a remote signer, your key is yours — not ours.</li>
            <li><strong>We cannot recover your key.</strong> There is no reset button. If you lose access to your key (and the passphrase or signer that unlocks it), the account is effectively gone. Back things up.</li>
            <li>Passkeys, if you enroll one, are an extra local unlock path — not a recovery service we provide.</li>
            <li>Keeping your signer and devices secure — screen lock, disk encryption, no shared accounts — is part of keeping the account secure. We can't protect what happens outside this app.</li>
          </ul>
        </Section>

        <Section icon={Radio} title="What you publish">
          <p>Anything you post is signed by your key and broadcast to your chosen relays. Once it's out, copies may persist on relays, caches, and indexers outside our control. We can't "unpublish" a note for you.</p>
          <p>You're responsible for what you publish. Don't use Relay Outpost to:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Do anything illegal under the laws that apply to you.</li>
            <li>Impersonate others to deceive, defraud, or harm them.</li>
            <li>Attack, abuse, or overload relays, users, or this app.</li>
            <li>Distribute content that sexually exploits minors — see our <Link href="/child-safety" className="text-brand hover:underline" data-testid="link-covenant-child-safety">Child Safety Standards</Link>.</li>
          </ul>
          <p>We have no tolerance for content that crosses those lines, or for abusive users. You can report content from any post, profile, or media item in the app; reports are reviewed, and abusive accounts can be muted, blocked, and filtered out of your experience.</p>
          <p>Beyond those lines, the network is what its participants make of it — we don't editorially curate what the people you follow choose to say.</p>
        </Section>

        <Section icon={Users} title="Relays and third parties">
          <p>Relays are operated by third parties. They choose what they store, what they serve, and what they block. Connecting to a relay means using their service under their rules, not ours. We may suggest default relays, but you can change or remove them any time.</p>
          <p>Integrations like media uploads, name verification, and Lightning zaps involve other services with their own terms and behavior we don't control.</p>
        </Section>

        <Section icon={FileText} title="The software itself">
          <p>Relay Outpost is provided <strong>as-is</strong>, without warranty of any kind. As a beta, features may change, break, or be removed, and experimental ones can fail in unexpected ways. Use them at your own discretion, and don't rely on the app as your only copy of anything important.</p>
        </Section>

        <Section icon={AlertTriangle} title="Limits of liability">
          <p>To the fullest extent permitted by law, the operators and contributors of Relay Outpost are not liable for any loss, damage, or harm resulting from: lost or compromised keys, lost or altered data, relay behavior, third-party service behavior, or any use of content obtained through the Nostr network.</p>
          <p>If any part of these terms is unenforceable where you are, the rest still applies.</p>
        </Section>

        <Section icon={Scale} title="Formal language">
          <p className="text-[12px] text-foreground/70 dark:text-foreground/65">
            THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
          </p>
          <p>
            These terms may be updated. Material changes will be surfaced in the app. Continued use after an update means you accept the revised terms. If you don't, stop using the app and, if you wish, export your key and move to another Nostr client — the network will still be there.
          </p>
        </Section>
      </div>

      <div className="mt-8 flex flex-wrap gap-3 text-[11px] text-muted-foreground/70">
        <Link href="/privacy" className="hover:text-foreground transition-colors underline decoration-dotted" data-testid="link-to-privacy">
          Privacy
        </Link>
        <span className="text-muted-foreground/30">·</span>
        <Link href="/settings" className="hover:text-foreground transition-colors underline decoration-dotted" data-testid="link-to-settings-covenant">
          Settings
        </Link>
      </div>
    </div>
    </div>
  );
}
