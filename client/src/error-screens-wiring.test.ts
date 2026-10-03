/**
 * Where the error screens are wired in. Source scans: the pieces themselves
 * are tested in components/error-screen.test.ts and lib/nostr-routes.test.ts;
 * these pin that the app actually reaches them.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, f), "utf8");

describe("bare nostr links", () => {
  const app = read("App.tsx");

  it("members: a /:ref route sits just before the 404 and sends ids on to their page", () => {
    const router = app.slice(app.indexOf("<Route path=\"/live\" component={LiveStreams} />"), app.indexOf("</Switch>", app.indexOf("<Route path=\"/live\" component={LiveStreams} />")));
    expect(router).toMatch(/<Route path="\/:ref" component=\{BareNostrLink\} \/>\s*<Route component=\{NotFound\} \/>/);
    const link = app.slice(app.indexOf("function BareNostrLink"), app.indexOf("function LandingRedirect"));
    expect(link).toMatch(/bareNostrRoute\(location\)/);
    expect(link).toMatch(/if \(!target\) return <NotFound \/>/);
    expect(link).toMatch(/<RouteRedirect to=/);
    expect(link).toMatch(/<LinkNotOpenable/);
  });

  it("visitors: the guest previews match a bare id as the page it names, with the same patterns", () => {
    expect(app).toMatch(/const guestPath = useMemo\(\(\) => bareNostrRoute\(location\)\?\.to \?\? location, \[location\]\);/);
    for (const name of ["guestNoteId", "guestNpub", "guestNaddr"]) {
      const line = app.split("\n").find((l) => l.includes(`const ${name} = useMemo`))!;
      expect(line, name).toContain("guestPath.match(");
      expect(line, name).toContain("[guestPath]");
    }
  });
});

describe("the thread page", () => {
  const thread = read("pages/Thread.tsx");
  it("an id that doesn't decode says the link can't be opened, never offers a relay search", () => {
    expect(thread).toMatch(/decodeThreadRef\(noteId\)/);
    expect(thread).toMatch(/!loading && !event && !decoded && <LinkNotOpenable/);
    expect(thread).toMatch(/!loading && !event && decoded && \(\s*<EventNotFound/);
    expect(thread).not.toMatch(/function decodeNoteId/);
  });
});

describe("error states use the shared screen", () => {
  it.each([
    ["App.tsx", "RouteErrorFallback"],
    ["components/FeedErrorBoundary.tsx", "FeedErrorBoundary"],
    ["components/ErrorBoundary.tsx", "ErrorBoundary"],
    ["pages/not-found.tsx", "NotFound"],
    ["pages/Thread.tsx", "EventNotFound"],
    ["pages/ArticleDetail.tsx", "ArticleDetail"],
    ["pages/Community.tsx", "Community"],
    ["pages/Profile.tsx", "Profile"],
    ["pages/RelayOpsCenter.tsx", "RelayOpsCenter"],
  ])("%s (%s)", (file) => {
    expect(read(file)).toMatch(/<ErrorScreen\b|<LinkNotOpenable\b/);
  });

  it("the old shouty strings are gone", () => {
    const all = ["pages/not-found.tsx", "pages/RelayOpsCenter.tsx", "pages/Thread.tsx", "pages/Profile.tsx", "components/ErrorBoundary.tsx", "components/FeedErrorBoundary.tsx"].map(read).join("\n");
    for (const s of ["404 Not Found", "Return to Feed", "Access Denied", "Event not found", "Invalid profile key", "Something broke in the feed", "Something went wrong loading this widget", "animate-bounce"]) {
      expect(all, s).not.toContain(s);
    }
  });
});
