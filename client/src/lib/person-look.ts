/**
 * How a person looks to you, everywhere (owner, 2026-10-12). One answer every
 * surface renders from, in this order: your name for them; your photo for
 * them; failing a photo, your icon tile (emoji/color); failing that, their
 * real picture; failing that, initials. The session's "show real names" flip
 * reveals the originals. Photos live on this device only (lib/petname-images);
 * names and tiles follow you across devices.
 */
import type { Event } from "nostr-tools";
import { getDisplayName, getAvatarUrl } from "./nostr-helpers";
import { getPetname, isShowingRealNames } from "./petnames";
import { petnameAvatarFor } from "./petname-images";

export interface PersonTile { emoji?: string; color?: string }
export interface PersonLook {
  name: string;
  /** Your photo for them, or their real picture (proxied). Undefined when a tile stands in, or nothing is known. */
  avatarUrl?: string;
  /** Your icon for them: replaces the picture entirely (a half-replaced avatar reads as broken). */
  tile?: PersonTile;
}

export function personLook(profile: Event | undefined, pubkey: string, fallback?: string, raw?: { name?: string; picture?: string }): PersonLook {
  const short = fallback ?? `${pubkey.slice(0, 8)}…`;
  const real = profile ? getDisplayName(profile, short) : raw?.name;
  const custom = isShowingRealNames() ? undefined : getPetname("person", pubkey);
  const name = (custom?.name ?? real ?? short) || short;
  const photo = custom ? petnameAvatarFor("person", pubkey) : undefined;
  if (photo) return { name, avatarUrl: photo };
  if (custom && (custom.emoji || custom.color)) return { name, tile: { emoji: custom.emoji, color: custom.color } };
  return { name, avatarUrl: profile ? getAvatarUrl(profile) : raw?.picture };
}
