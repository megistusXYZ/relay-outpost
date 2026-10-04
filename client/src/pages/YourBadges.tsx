/**
 * You › Your badges (owner, 2026-10-04): making and giving badges is about
 * you, not the relay you run, so it moved here from the relay console's
 * Who can post.
 */
import { useDocumentTitle } from "@/hooks/use-document-title";
import { BadgeManagementPanel } from "@/components/BadgeManagement";

export default function YourBadges() {
  useDocumentTitle("Your badges");
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4" data-testid="page-your-badges">
      <p className="text-[15px] text-muted-foreground">Make badges and give them to people — for helping out, for being early, for anything you like.</p>
      <BadgeManagementPanel />
    </div>
  );
}
