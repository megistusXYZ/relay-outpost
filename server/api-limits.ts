/**
 * Per-IP request limits for the API (api-limits.test.ts). Moved out of
 * index.ts so they can be exercised on a real server in a test.
 */
import type { Express } from "express";
import rateLimit from "express-rate-limit";

export function applyApiLimits(app: Express): void {
  // Sized from a measured session (2026-10-08): a guest's first 30 s on Home
  // made 38 calls — handle checks, link previews — so a signed-in scroll is a
  // few hundred a minute, and phones behind one carrier IP share a bucket.
  // 120 cut handles, previews and the update check off mid-scroll. The
  // expensive routes keep their own tight buckets below.
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
    // The HLS proxy has its own playback-sized bucket below. Counting its
    // playlist polls here too would 429 a live stream after ~30s of watching —
    // every mounted limiter on the path counts the same request.
    // The update check (/api/version) is a few bytes from memory: refusing it
    // only stops people learning a new version is out.
    skip: (req) => req.originalUrl.startsWith("/api/stream/proxy") || req.originalUrl.startsWith("/api/version"),
  });
  app.use("/api", generalLimiter);

  const heavyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded for this resource. Please try again later." },
  });
  app.use("/api/tts", heavyLimiter);
  // Link previews get their OWN bucket (the RSS and stream-proxy story again):
  // on the shared 20/min heavyLimiter a feed of links used it up in under a
  // minute — previews vanished, and text-to-speech went with them. Previews
  // are cached an hour server-side (ogCache), so most of these never leave.
  const ogLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded for link previews. Please try again later." },
  });
  app.use("/api/og", ogLimiter);
  // Call tokens (/.well-known/concord/av) live outside /api, so none of the
  // limits above reach them. A call join asks once; 30 a minute per IP is plenty.
  const callTokenLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use("/.well-known/concord/av", callTokenLimiter);
  // RSS gets its OWN generous bucket. It was on the SHARED heavyLimiter (20/min
  // across tts+og+stream+rss+image-proxy), but the News "All feeds" view fans out
  // to dozens of feeds on open — so it exhausted the shared 20/min and 429'd its
  // own page. A feed reader legitimately makes many requests; 120/min matches the
  // general /api limiter. The image proxy (/api/rss/image-proxy) gets a SEPARATE
  // bucket so loading feed thumbnails can't starve the feed fetches themselves;
  // the feed limiter skips it so image requests don't double-count.
  const rssLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded for feeds. Please try again later." },
    skip: (req) => req.originalUrl.startsWith("/api/rss/image-proxy"),
  });
  const rssImageLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded for feed images. Please try again later." },
  });
  app.use("/api/rss/image-proxy", rssImageLimiter);
  app.use("/api/rss", rssLimiter);
  // Translate gets its OWN bucket: heavyLimiter is one shared instance, so its
  // counter spans every path it's mounted on — an RSS-heavy page load would
  // exhaust it and 429 the translation probe/requests.
  const translateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded for this resource. Please try again later." },
  });
  app.use("/api/translate", translateLimiter);

  const gifLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded for GIF search. Please try again later." },
  });
  app.use("/api/gifs", gifLimiter);

  // The HLS proxy gets a PLAYBACK-SIZED bucket, not an API-sized one. It sat on
  // the shared heavyLimiter (20/min across tts+og+proxy+health-check), and every
  // request ALSO counted against the /api/stream and general /api buckets — but
  // low-latency HLS polls the playlist several times a second and fetches a
  // media segment every couple more, ~4-6 req/s sustained. Watching ANY live
  // stream therefore died in ~10 seconds flat: our own server 429'd the playlist,
  // hls.js read that as a fatal network error, and the player announced
  // "Stream unavailable — it may have ended" about a broadcast that was fine
  // (measured live: chat scrolling, 5 viewers, our proxy serving 429s). Same
  // defect class the rssLimiter comment above records — a proxy whose consumer
  // legitimately makes many requests starving in a bucket sized for pages.
  // 600/min ≈ 10 req/s per IP: headroom for one LL-HLS session plus UI, still a
  // hard ceiling against abuse (domain allowlist + host safety already gate WHAT
  // it will fetch).
  const hlsProxyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded for stream playback. Please try again later." },
  });
  app.use("/api/stream/proxy", hlsProxyLimiter);
  app.use("/api/stream/health-check-batch", heavyLimiter);

  const streamLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded for stream resources. Please try again later." },
    // Playback requests are budgeted by hlsProxyLimiter above, not here.
    skip: (req) => req.originalUrl.startsWith("/api/stream/proxy"),
  });
  app.use("/api/stream", streamLimiter);
}
