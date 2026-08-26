import { useState, useEffect, useMemo, useCallback } from "react";
import { notifyNeedsYouChanged } from "@/contexts/NeedsYouContext";
import { nip19 } from "nostr-tools";
import { sendPutUser } from "@/lib/nip29";
import { fetchProfilesCached, getCachedProfile } from "@/lib/nostr";
import { recordDateAdded } from "@/pages/relay-ops/shared";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveFormPanel } from "@/components/ui/responsive-form-panel";
import { RelayOutpostInlineLoader } from "@/components/RelayOutpostLoader";
import { UserPlus, AlertCircle, Check } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relayUrl: string;
  groupId: string;
  /** Key used for recordDateAdded (defaults to groupId). Some surfaces scope by `${relay}:${groupId}`. */
  groupKey?: string;
  /** Called after a successful add, with the resolved hex pubkey + roles. */
  onAdded?: (pubkey: string, roles: string[]) => void;
  /** Optional title override. */
  title?: string;
  /** Optional description override. */
  description?: string;
};

function parseIdentifier(input: string): { pubkey: string | null; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) return { pubkey: null, error: null };
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return { pubkey: trimmed.toLowerCase(), error: null };
  }
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return { pubkey: decoded.data as string, error: null };
      return { pubkey: null, error: "Not an npub identifier" };
    } catch {
      return { pubkey: null, error: "Invalid npub" };
    }
  }
  if (trimmed.startsWith("nprofile1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "nprofile") {
        return { pubkey: (decoded.data as { pubkey: string }).pubkey, error: null };
      }
      return { pubkey: null, error: "Not an nprofile identifier" };
    } catch {
      return { pubkey: null, error: "Invalid nprofile" };
    }
  }
  return { pubkey: null, error: "Use npub, nprofile, or 64-char hex" };
}

function shortNpub(hex: string): string {
  try {
    const npub = nip19.npubEncode(hex);
    return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  } catch {
    return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
  }
}

export function AddMemberSheet({
  open,
  onOpenChange,
  relayUrl,
  groupId,
  groupKey,
  onAdded,
  title = "Add member",
  description = "Add a user directly to this group. They'll be able to read and post immediately.",
}: Props) {
  const { toast } = useToast();
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState("");
  const [adding, setAdding] = useState(false);
  const [profileTick, setProfileTick] = useState(0);

  const { pubkey, error } = useMemo(() => parseIdentifier(identifier), [identifier]);

  useEffect(() => {
    if (!open) {
      setIdentifier("");
      setRole("");
      setAdding(false);
    }
  }, [open]);

  useEffect(() => {
    if (!pubkey) return;
    fetchProfilesCached([pubkey]);
    const id = setInterval(() => setProfileTick((t) => t + 1), 600);
    const stop = setTimeout(() => clearInterval(id), 4000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [pubkey]);

  const profile = useMemo(() => {
    if (!pubkey) return null;
    const cached = getCachedProfile(pubkey);
    if (!cached) return null;
    try {
      const content = JSON.parse(cached.content || "{}");
      return {
        name: (content.display_name || content.name || "").toString().slice(0, 60),
        picture: typeof content.picture === "string" ? content.picture : undefined,
        nip05: typeof content.nip05 === "string" ? content.nip05 : undefined,
      };
    } catch {
      return null;
    }
    // profileTick intentionally re-evaluates this memo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubkey, profileTick]);

  const effectiveKey = groupKey || groupId;

  const handleAdd = useCallback(async () => {
    if (!pubkey) return;
    setAdding(true);
    try {
      const roles = role.trim()
        ? role.trim().split(",").map((r) => r.trim()).filter(Boolean)
        : [];
      const { ok, error } = await sendPutUser(relayUrl, groupId, pubkey, roles);
      if (ok) {
        // Adding someone directly resolves any pending request from them.
        notifyNeedsYouChanged();
        toast({ title: "Member added", description: profile?.name || shortNpub(pubkey) });
        recordDateAdded(relayUrl, `members:${effectiveKey}`, pubkey);
        if (roles.length > 0) {
          recordDateAdded(relayUrl, `admins:${effectiveKey}`, pubkey);
        }
        onAdded?.(pubkey, roles);
        onOpenChange(false);
      } else {
        toast({
          title: "Couldn't add member",
          // The guessed cause is gone. "Check that you're an admin" is right
          // only when the refusal is `restricted`; it is wrong and misleading
          // for payment-required, rate-limited, or a malformed p-tag. The relay
          // says which one it is — print that instead of guessing.
          description: error ?? "The relay rejected the add.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Error adding member", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }, [pubkey, role, relayUrl, groupId, effectiveKey, profile, onAdded, onOpenChange, toast]);

  return (
    <ResponsiveFormPanel
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="border-brand/20 sm:max-h-[calc(100dvh-4rem)]"
      title={
        <>
          <UserPlus className="w-4 h-4 text-brand" />
          {title}
        </>
      }
      description={description}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!pubkey || adding}
            className="h-8 text-xs gap-1.5 bg-brand hover:bg-brand text-white"
            data-testid="button-add-member-confirm"
          >
            {adding ? (
              <><RelayOutpostInlineLoader className="w-3 h-3" /> Adding…</>
            ) : (
              <><UserPlus className="w-3 h-3" /> Add member</>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 py-2">
          <div>
            <label className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1 block">
              Identifier
            </label>
            <Input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="npub1…  ·  nprofile1…  ·  64-char hex"
              className="h-8 text-base sm:text-xs font-mono bg-muted/20 border-border/30"
              autoFocus
              data-testid="input-add-member-identifier"
            />
            {error && (
              <p className="mt-1 text-[10px] text-amber-600/80 dark:text-amber-400/70 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                {error}
              </p>
            )}
          </div>

          {pubkey && (
            <div className="flex items-center gap-2 p-2 rounded-md bg-muted/20 border border-border/30">
              <Avatar className="w-8 h-8">
                {profile?.picture && <AvatarImage src={profile.picture} alt="" />}
                <AvatarFallback className="text-[10px] bg-muted/40">
                  {(profile?.name || pubkey).slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate text-foreground/90">
                  {profile?.name || shortNpub(pubkey)}
                </div>
                <div className="text-[10px] text-muted-foreground/50 truncate font-mono">
                  {profile?.nip05 || shortNpub(pubkey)}
                </div>
              </div>
              <Check className="w-3.5 h-3.5 text-emerald-500/80 shrink-0" />
            </div>
          )}

          <div>
            <label className="text-[10px] font-brand tracking-wider uppercase text-muted-foreground/50 mb-1 block">
              Role <span className="normal-case text-muted-foreground/40">(optional · comma-separated)</span>
            </label>
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. admin, moderator"
              className="h-8 text-base sm:text-xs bg-muted/20 border-border/30"
              data-testid="input-add-member-role"
            />
            <p className="mt-1 text-[10px] text-muted-foreground/40">
              Leave empty to add as a regular member. Roles grant moderation power on the relay.
            </p>
          </div>
      </div>
    </ResponsiveFormPanel>
  );
}
