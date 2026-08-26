/**
 * Config-driven layout for the living-identity profile skin. The renderer walks
 * these section lists in order per column — so the arrangement is data, not
 * hardcoded JSX. v1 ships ONE baked-in default; a section not yet implemented
 * (or with no data for this profile) simply renders nothing, so the config can
 * list the full vocabulary while chunks land incrementally.
 *
 * (There is intentionally NO owner-published layout path — this is a viewer
 * skin. The config indirection just keeps the renderer clean and future-open.)
 */
export type IdentitySection =
  | "identity"   // avatar + name + nip05 + verified
  | "now"        // NIP-38 status / live / now-playing
  | "contact"    // Follow · Message · Zap actions
  | "details"    // nip05 · site · ⚡addr · on-Nostr-since · relays
  | "circle"     // Top-8-style grid, ranked by friends-in-common
  | "vouches"    // conditional: signed endorsements (kind-31871)
  | "stats"      // followers · following · posts · zaps
  | "featured"   // portfolio shelves: top note · article · stream · track · badges
  | "value"      // support / zap block
  | "heatmap"    // posting-activity contribution grid
  | "posts";     // the note stream (reuses the classic tab content)

export interface IdentityLayoutConfig {
  leftRail: IdentitySection[];
  main: IdentitySection[];
}

/** The single baked-in default arrangement (restraint budget: quiet, one item per shelf). */
export const DEFAULT_IDENTITY_LAYOUT: IdentityLayoutConfig = {
  leftRail: ["identity", "now", "contact", "details", "circle", "vouches"],
  main: ["stats", "featured", "heatmap", "posts"],
};
