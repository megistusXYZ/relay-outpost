import { Linkify } from "@/components/Linkify";

/**
 * A marketplace listing's description as the seller wrote it, with its web
 * links tappable. The text is untrusted, so linking goes through Linkify:
 * http(s) only, new tab, no opener.
 */
export function ListingDescription({ text }: { text: string }) {
  return (
    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words" data-testid="listing-description">
      <Linkify text={text} />
    </p>
  );
}
