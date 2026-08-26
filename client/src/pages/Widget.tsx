import { useEffect, useMemo } from "react";
import { useSearch } from "wouter";
import type { NostrEvent } from "nostr-tools";
import { eventStore, subscribeToFeed } from "@/lib/nostr";
import { use$ } from "applesauce-react/hooks";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { RelayOutpostLoader } from "@/components/RelayOutpostLoader";
import { Button } from "@/components/ui/button";
import {
  decodeNpubToHex,
  getArticleTitle,
  getArticleSummary,
} from "@/helpers/nostr-helpers";

const KIND_TEXT_NOTE = 1;
const KIND_LONG_FORM = 30023;

function WidgetContent() {
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const npub = params.get("npub");
  const relay = params.get("relay");

  const hexPubkey = useMemo(
    () => (npub ? decodeNpubToHex(npub) : null),
    [npub],
  );

  const relays = useMemo(
    () => (relay ? [relay] : ["wss://relay.damus.io"]),
    [relay],
  );

  const filter = useMemo(() => {
    if (!hexPubkey) return null;
    return {
      kinds: [KIND_TEXT_NOTE, KIND_LONG_FORM],
      authors: [hexPubkey],
      limit: 10,
    };
  }, [hexPubkey]);

  useEffect(() => {
    if (!filter) return;
    const sub = subscribeToFeed(filter, relays);
    return () => {
      sub.close();
    };
  }, [filter, relays]);

  const timelineEvents = use$(() => filter ? eventStore.timeline(filter) : undefined, [filter]);
  const events = timelineEvents ?? ([] as NostrEvent[]);

  if (!npub) {
    return (
      <div
        className="flex items-center justify-center h-full p-8"
        data-testid="widget-missing-npub"
      >
        <p className="text-neutral-500 text-sm">
          Missing <code className="text-neutral-600">npub</code> parameter.
        </p>
      </div>
    );
  }

  if (!hexPubkey) {
    return (
      <div
        className="flex items-center justify-center h-full p-8"
        data-testid="widget-invalid-npub"
      >
        <p className="text-neutral-500 text-sm">
          Invalid npub provided.
        </p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-full p-8"
        data-testid="widget-loading"
      >
        <RelayOutpostLoader size="md" label="Loading events..." className="text-neutral-400" />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 p-4"
      data-testid="widget-event-list"
    >
      {events.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}

function EventCard({ event }: { event: NostrEvent }) {
  if (event.kind === KIND_LONG_FORM) {
    return <ArticleCard event={event} />;
  }
  return <NoteCard event={event} />;
}

function ArticleCard({ event }: { event: NostrEvent }) {
  const title = getArticleTitle(event);
  const summary = getArticleSummary(event);

  return (
    <div
      className="rounded-md border border-white/20 bg-white/60 backdrop-blur-xl p-4 flex flex-col gap-2"
      data-testid={`card-article-${event.id}`}
    >
      {title && (
        <h3
          className="text-neutral-800 font-semibold text-sm leading-snug"
          data-testid={`text-title-${event.id}`}
        >
          {title}
        </h3>
      )}
      {summary && (
        <p
          className="text-neutral-600 text-xs leading-relaxed"
          data-testid={`text-summary-${event.id}`}
        >
          {summary}
        </p>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="self-start mt-1 text-xs font-medium text-neutral-700 border border-white/30 bg-white/40 backdrop-blur-sm"
        data-testid={`button-read-${event.id}`}
      >
        Read
      </Button>
    </div>
  );
}

function NoteCard({ event }: { event: NostrEvent }) {
  const truncated =
    event.content.length > 150
      ? event.content.slice(0, 150) + "..."
      : event.content;

  return (
    <div
      className="rounded-md border border-white/20 bg-white/60 backdrop-blur-xl p-4"
      data-testid={`card-note-${event.id}`}
    >
      <p
        className="text-neutral-800 text-sm leading-relaxed whitespace-pre-wrap break-words"
        data-testid={`text-content-${event.id}`}
      >
        {truncated}
      </p>
    </div>
  );
}

export default function Widget() {
  return (
    <div
      className="min-h-screen bg-white/40 backdrop-blur-xl"
      data-testid="page-widget"
    >
      <ErrorBoundary>
        <WidgetContent />
      </ErrorBoundary>
    </div>
  );
}
