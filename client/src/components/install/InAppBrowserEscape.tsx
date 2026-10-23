import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { chromeIntentUrl, type InstallGuide } from "@/lib/install-guide";
import { InstallSteps } from "./InstallSteps";

/**
 * The way out of another app's built-in browser (Instagram, X, Telegram…),
 * which can't install apps: on Android one button opens this page in Chrome;
 * everywhere, the steps for the app's own menu and a copy-link button.
 */
export function InAppBrowserEscape({ guide, className = "" }: { guide: InstallGuide; className?: string }) {
  const { toast } = useToast();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast({ title: "Link copied", description: "Paste it into Safari or Chrome." });
    } catch {
      toast({ title: "Couldn't copy the link", description: window.location.href });
    }
  };

  return (
    <div className={className} data-testid="in-app-browser-escape">
      {guide.action === "open-in-chrome" && (
        <Button asChild size="sm" className="h-9 mb-3" data-testid="button-open-in-chrome">
          <a href={chromeIntentUrl(window.location)}>Open in Chrome</a>
        </Button>
      )}
      <InstallSteps guide={guide} />
      {guide.copyLink && (
        <Button size="sm" variant="outline" className="h-9 mt-3" onClick={copyLink} data-testid="button-copy-page-link">
          Copy link
        </Button>
      )}
    </div>
  );
}
