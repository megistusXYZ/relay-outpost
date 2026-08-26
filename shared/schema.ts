import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const customFeeds = pgTable("custom_feeds", {
  id: serial("id").primaryKey(),
  pubkey: text("pubkey").notNull(),
  name: text("name").notNull(),
  hashtags: text("hashtags").array().notNull().default([]),
  authorPubkeys: text("author_pubkeys").array().notNull().default([]),
  includeKeywords: text("include_keywords").array().notNull().default([]),
  excludeKeywords: text("exclude_keywords").array().notNull().default([]),
  contentType: text("content_type").notNull().default("all"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCustomFeedSchema = createInsertSchema(customFeeds).omit({
  id: true,
  createdAt: true,
});

export type CustomFeed = typeof customFeeds.$inferSelect;
export type InsertCustomFeed = z.infer<typeof insertCustomFeedSchema>;

// Rolling history of Podcast Index trending snapshots (top ~15 per category,
// captured request-driven at most once per ~20h, pruned after ~14 days). Powers
// the "Rising now" trend-suggestion engine in the Add-feed dialog.
export const podcastTrendSnapshots = pgTable("podcast_trend_snapshots", {
  id: serial("id").primaryKey(),
  /** Normalized trending category key (Podcast Index id as text; "" = global Top). */
  category: text("category").notNull().default(""),
  /** UTC day of capture (YYYY-MM-DD) — makes "distinct trending days" trivial. */
  day: text("day").notNull(),
  feedId: integer("feed_id").notNull(),
  title: text("title").notNull(),
  /** 1-based position within the category's trending list at capture time. */
  rank: integer("rank").notNull(),
  trendScore: integer("trend_score").notNull().default(0),
  /** JSON-serialized mapped PodcastFeed — lets suggestions render full cards. */
  meta: text("meta"),
  capturedAt: timestamp("captured_at").defaultNow(),
});

export type PodcastTrendSnapshot = typeof podcastTrendSnapshots.$inferSelect;

export const scheduledPosts = pgTable("scheduled_posts", {
  id: serial("id").primaryKey(),
  pubkey: text("pubkey").notNull(),
  encryptedEvent: text("encrypted_event").notNull(),
  relayUrls: text("relay_urls").array().notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  status: text("status").notNull().default("pending"),
  kind: integer("kind").notNull(),
  contentPreview: text("content_preview").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  publishedAt: timestamp("published_at"),
  failureReason: text("failure_reason"),
});

export const insertScheduledPostSchema = createInsertSchema(scheduledPosts).omit({
  id: true,
  createdAt: true,
  publishedAt: true,
  failureReason: true,
});

export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type InsertScheduledPost = z.infer<typeof insertScheduledPostSchema>;
