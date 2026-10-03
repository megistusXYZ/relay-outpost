import { ErrorScreen } from "@/components/ErrorScreen";

/** A path the app has no page for. Calm, one way home, one way to look. */
export default function NotFound() {
  return (
    <ErrorScreen
      kind="not-found"
      title="This page isn't here"
      body="The link may be old, or the page moved. Everything else is right where you left it."
      primary={{ label: "Go to your feed", href: "/", testId: "button-not-found-home" }}
      secondary={{ label: "Search", href: "/search", testId: "button-not-found-search" }}
      testId="page-not-found"
    />
  );
}

/** A Nostr link we can't turn into a page: it doesn't decode, or we have no page for its kind. */
export function LinkNotOpenable({ layout = "page", unsupported = false }: { layout?: "page" | "section"; unsupported?: boolean }) {
  return (
    <ErrorScreen
      kind="link"
      layout={layout}
      title="We can't open this link"
      body={
        unsupported
          ? "It's a Nostr address, but not a kind of post Relay Outpost can show yet."
          : "It doesn't look like a Nostr address we recognise. Check it was copied in full."
      }
      primary={{ label: "Go to your feed", href: "/", testId: "button-link-home" }}
      testId="link-not-openable"
    />
  );
}
