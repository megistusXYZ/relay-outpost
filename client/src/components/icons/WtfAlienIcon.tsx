/**
 * The Help mascot. It was an alien; it is Otto now (owner, 2026-11-16), with
 * the asking face, since this icon marks the places that answer questions.
 * The name and signature stay so the nineteen call sites need no change.
 */
import { OttoMark } from "@/components/OttoMark";

export function WtfAlienIcon({ className }: { className?: string }) {
  return <OttoMark mood="ask" className={className} />;
}
