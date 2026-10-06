/**
 * You › Badges (owner, 2026-10-06 — badges-plan): what you've made, a studio
 * to make or edit one, and a way to give them. Moved here from the relay
 * console on 2026-10-04: making and giving badges is about you.
 */
import { useState } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { BadgeManagementPanel } from "@/components/BadgeManagement";
import { BadgeStudio } from "@/components/badges/BadgeStudio";
import { YourBadgesList } from "@/components/badges/YourBadgesList";
import type { BadgeDefinition } from "@/lib/nip58-badges";

type Studio = { mode: "closed" } | { mode: "new"; template?: string } | { mode: "edit"; def: BadgeDefinition };

export default function YourBadges() {
  useDocumentTitle("Your badges");
  const [studio, setStudio] = useState<Studio>({ mode: "closed" });
  const [refreshKey, setRefreshKey] = useState(0);
  const close = (changed: boolean) => { setStudio({ mode: "closed" }); if (changed) setRefreshKey((k) => k + 1); };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6" data-testid="page-your-badges">
      <p className="text-[15px] text-muted-foreground">Make badges and give them to people — for helping out, for being early, for anything you like.</p>
      {studio.mode !== "closed" ? (
        <BadgeStudio
          key={studio.mode === "edit" ? studio.def.dTag : `new-${studio.template ?? ""}`}
          editing={studio.mode === "edit" ? studio.def : undefined}
          startTemplate={studio.mode === "new" ? studio.template : undefined}
          onDone={() => close(true)}
          onCancel={() => close(false)}
        />
      ) : (
        <>
          <YourBadgesList
            refreshKey={refreshKey}
            onCreate={() => setStudio({ mode: "new" })}
            onThank={() => setStudio({ mode: "new", template: "thanks" })}
            onEdit={(def) => setStudio({ mode: "edit", def })}
          />
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Give a badge</h2>
            <BadgeManagementPanel refreshKey={refreshKey} />
          </section>
        </>
      )}
    </div>
  );
}
