/**
 * Home's empty states (pages/Home.tsx), drawn as Otto (components/OttoEmpty)
 * since 2026-11-16. The four names stay; each is a mood:
 *
 *   TuneAntenna   nothing to show yet            quiet
 *   NoSignal      the relays could not be reached looking
 *   RadarSweep    still asking                   looking
 *   StaticNoise   answered, and empty            quiet
 */
import { cn } from "@/lib/utils";
import { OttoEmpty } from "@/components/OttoEmpty";

interface IllustrationProps {
  className?: string;
}

export function TuneAntennaIllustration({ className }: IllustrationProps) {
  return <OttoEmpty mood="quiet" size={88} className={cn(className)} />;
}

export function NoSignalIllustration({ className }: IllustrationProps) {
  return <OttoEmpty mood="looking" size={88} className={cn(className)} />;
}

export function RadarSweepIllustration({ className }: IllustrationProps) {
  return <OttoEmpty mood="looking" size={88} className={cn(className)} />;
}

export function StaticNoiseIllustration({ className }: IllustrationProps) {
  return <OttoEmpty mood="quiet" size={88} className={cn(className)} />;
}
