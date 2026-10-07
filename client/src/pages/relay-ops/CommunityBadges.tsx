/**
 * Community › Badges (owner, 2026-10-06 — badges-plan step 4): the
 * community's own badges, like Discord roles. The owner makes and gives them
 * (signed by the owner, carrying the community, so they read "from <name>");
 * moderators and the team see them but can't change them yet.
 */
import { useState } from "react";
import { BadgeStudio } from "@/components/badges/BadgeStudio";
import { YourBadgesList } from "@/components/badges/YourBadgesList";
import { GiveBadge } from "@/components/badges/GiveBadge";
import type { BadgeDefinition } from "@/lib/nip58-badges";
import { SETUP_CHANGED_EVENT } from "./SetupChecklist";

type Studio = { mode: "closed" } | { mode: "new"; template?: string } | { mode: "edit"; def: BadgeDefinition };

export function CommunityBadges({ relayUrl, ownerPubkey, isOwner }: { relayUrl: string; ownerPubkey?: string; isOwner: boolean }) {
  const [studio, setStudio] = useState<Studio>({ mode: "closed" });
  const [refreshKey, setRefreshKey] = useState(0);
  const close = (changed: boolean) => {
    setStudio({ mode: "closed" });
    if (!changed) return;
    setRefreshKey((k) => k + 1);
    // Overview's "Make your first badge" re-reads what's true.
    try { window.dispatchEvent(new CustomEvent(SETUP_CHANGED_EVENT, { detail: { relayUrl } })); } catch { /* no window */ }
  };

  if (studio.mode !== "closed") {
    return (
      <BadgeStudio
        key={studio.mode === "edit" ? studio.def.dTag : `new-${studio.template ?? ""}`}
        community={relayUrl}
        editing={studio.mode === "edit" ? studio.def : undefined}
        startTemplate={studio.mode === "new" ? studio.template : undefined}
        onDone={() => close(true)}
        onCancel={() => close(false)}
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="ops-community-badges">
      <p className="text-sm text-muted-foreground">
        Badges your community gives — for founding members, helpers, moderators, anyone you want to recognise. People choose whether to show them.
      </p>
      {!isOwner && <p className="text-sm text-muted-foreground" data-testid="ops-badges-owner-only">Only the owner can make and give the community's badges for now.</p>}
      <YourBadgesList
        title="Your community's badges"
        community={relayUrl}
        author={ownerPubkey}
        readOnly={!isOwner}
        refreshKey={refreshKey}
        onCreate={() => setStudio({ mode: "new" })}
        onThank={() => setStudio({ mode: "new", template: "founding" })}
        onEdit={(def) => setStudio({ mode: "edit", def })}
      />
      {isOwner && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">Give a badge</h2>
          <GiveBadge community={relayUrl} refreshKey={refreshKey} onCreate={() => setStudio({ mode: "new", template: "founding" })} />
        </section>
      )}
    </div>
  );
}
