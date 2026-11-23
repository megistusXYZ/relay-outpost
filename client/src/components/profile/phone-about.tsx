/**
 * A profile on a phone opens on the person's posts (owner, 2026-11-22). The
 * sections that used to sit above them (Circle, Communities, badges, Vouched
 * by, Details) live under an About chip, last in the stream's chip row. The
 * layout owns those sections and the stream owns the chips, so the layout
 * hands them across here; on wider screens the value is null and nothing moves.
 */
import { createContext, type ReactNode } from "react";

export interface PhoneAbout {
  /** The sections, ready to render under the About chip. */
  sections: ReactNode;
  /** False when the person has none of them: the chip then needs another reason to exist. */
  hasSections: boolean;
  /** Goes up each time the head's "more" is tapped: the stream opens About. */
  openRequest: number;
}

export const PhoneAboutContext = createContext<PhoneAbout | null>(null);

/** True inside About: the bio shows whole, not in its collapsed phone view. */
export const FullBioContext = createContext(false);
