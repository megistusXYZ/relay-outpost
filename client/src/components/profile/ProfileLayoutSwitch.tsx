/**
 * In-page quick-switch between the Classic (X-style) and Identity (living-page)
 * profile layouts. Desktop-only (hidden below lg), mirrors the Settings toggle —
 * writing the same preference so both stay in sync. This is the discovery path:
 * a Settings toggle alone would go unfound.
 */
import { useProfileLayout, setProfileLayout } from "@/hooks/use-profile-layout";

export function ProfileLayoutSwitch() {
  const layout = useProfileLayout();
  const cls = (active: boolean) =>
    `px-2.5 py-1 rounded-full transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`;
  return (
    <div className="hidden lg:inline-flex items-center rounded-full bg-background/75 backdrop-blur border border-border/50 p-0.5 text-[11px] font-medium shadow-sm" data-testid="profile-layout-switch">
      <button onClick={() => setProfileLayout("classic")} className={cls(layout === "classic")} data-testid="profile-switch-classic">Classic</button>
      <button onClick={() => setProfileLayout("identity")} className={cls(layout === "identity")} data-testid="profile-switch-identity">Identity</button>
    </div>
  );
}
