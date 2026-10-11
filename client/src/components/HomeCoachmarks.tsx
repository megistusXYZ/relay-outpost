/**
 * The Home feed's quick tour. The steps live in lib/tours.ts; the phone and
 * desktop "New post" steps are both listed and the panel drops the one whose
 * control isn't on this layout.
 */
import { MissionBriefing, restartMissionBriefing as restartGeneric } from "@/components/MissionBriefing";
import { TOURS } from "@/lib/tours";

/** Kept for callers that import it from here; prefer MissionBriefing's. */
export function restartMissionBriefing(pageId: string = "home"): void {
  restartGeneric(pageId);
}

export function HomeCoachmarks() {
  return <MissionBriefing pageId="home" steps={TOURS.home.steps} />;
}

export default HomeCoachmarks;
