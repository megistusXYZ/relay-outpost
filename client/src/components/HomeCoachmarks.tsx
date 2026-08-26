import { useMemo } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { MissionBriefing, restartMissionBriefing as restartGeneric, type BriefingStep } from "@/components/MissionBriefing";

const WELCOME_STEP: BriefingStep = {
  testId: null,
  title: "Welcome to your outpost",
  body: "This is your home base. Take a quick mission briefing — four short stops to get your bearings.",
};

const MOBILE_STEPS: BriefingStep[] = [
  WELCOME_STEP,
  {
    testId: "mobile-nav-feed",
    title: "Your home feed",
    body: "Posts from people you follow land here. Tap the **Feed** icon in the bottom bar to come back anytime.",
  },
  {
    testId: "mobile-nav-create",
    title: "Post anything",
    body: "Tap the **center button** in the bottom bar to compose. Photos, hashtags, and mentions all work.",
  },
  {
    testId: "mobile-nav-search",
    title: "Find people & topics",
    body: "Tap the **Search** icon in the bottom bar to find people, names, or any hashtag. Follow more people as you go.",
  },
];

const DESKTOP_STEPS: BriefingStep[] = [
  WELCOME_STEP,
  {
    testId: "container-feed-toggle",
    title: "Your starter feeds",
    body: "We pinned a few **starter feeds** based on your interests — switch your feed to **Saved** up here to browse and flip between them, or add your own.",
  },
  {
    testId: "button-fab-compose",
    title: "Compose anytime",
    body: "Click the **Compose** button (the round button at the bottom-right) to post. You can attach photos and tag people you follow.",
  },
];

/**
 * Restart the home mission briefing. Kept for backward compatibility — prefer
 * importing `restartMissionBriefing` from `@/components/MissionBriefing` and
 * passing an explicit pageId.
 */
export function restartMissionBriefing(pageId: string = "home"): void {
  restartGeneric(pageId);
}

export function HomeCoachmarks() {
  const { isMobile } = useSidebar();
  const steps = useMemo(() => (isMobile ? MOBILE_STEPS : DESKTOP_STEPS), [isMobile]);
  return <MissionBriefing pageId="home" steps={steps} />;
}

export default HomeCoachmarks;
