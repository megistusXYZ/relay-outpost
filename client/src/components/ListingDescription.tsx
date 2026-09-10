import { Linkify } from "@/components/Linkify";

/**
 * A marketplace listing's description as the seller wrote it, with its web
 * links tappable. The text is untrusted, so linking goes through Linkify:
 * http(s) only, new tab, no opener.
 */
export function ListingDescription({ text }: { text: string }) {
  return (
    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words" data-testid="listing-description">
      {/* One line per link, cut with an ellipsis: a long shop or gallery URL
          otherwise breaks mid-word across several lines of the sheet. The
          full address stays in the link's title and href. */}
      <Linkify text={text} className="inline-block max-w-full truncate align-bottom text-sky-500 hover:text-sky-400 underline underline-offset-2" />
    </p>
  );
}
