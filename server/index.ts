import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { startScheduler } from "./scheduler";
import { createServer } from "http";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";

const app = express();
// Replit's proxy used to gzip for us; the k8s ingress does not — without this
// every cold load ships the multi-MB SPA bundle raw (found in the 2026-08-20
// post-migration audit). Registered first so every later-mounted route and
// the static server inherit it; compressible-mime detection means streamed
// media (HLS proxy etc.) passes through untouched.
app.use(compression());
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      mediaSrc: ["'self'", "blob:", "https:"],
      connectSrc: [
        "'self'",
        "https:",
        "wss:",
        "data:",
        "blob:",
      ],
      frameSrc: [
        "'self'",
        "https://www.youtube.com",
        "https://www.youtube-nocookie.com",
        "https://player.vimeo.com",
        "https://rumble.com",
        "https://clips.twitch.tv",
        "https://player.twitch.tv",
        "https://streamable.com",
        "https://www.loom.com",
        "https://www.dailymotion.com",
        "https://embed.wavlake.com",
        // Audio spaces (lib/audio-space.ts): the in-app Corny Chat room
        // lightbox is an iframe of the room itself. Without this entry our
        // OWN frame-src blocked it — the "This content is blocked" report,
        // 2026-08-26. Add the host here when a service is promoted to
        // embeddable in that lib's measured allowlist.
        "https://cornychat.com",
      ],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  strictTransportSecurity: { maxAge: 31536000, includeSubDomains: false },
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
}));

app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=(), interest-cohort=()",
  );
  next();
});

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : [];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) {
      const isReplit = origin.endsWith(".replit.dev") || origin.endsWith(".repl.co") || origin.endsWith(".replit.app");
      return callback(null, isReplit || origin.startsWith("http://localhost:") || origin.startsWith("http://0.0.0.0:"));
    }
    return callback(null, allowedOrigins.includes(origin));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
}));

app.set("trust proxy", 1);

// Canonical host: 301 redirect www.relayop.xyz -> apex https://relayop.xyz.
// Placed after trust proxy (so the forwarded host is read correctly) and before
// routes/static so it covers every path. Only the www host is affected.
app.use((req, res, next) => {
  if (req.hostname === "www.relayop.xyz") {
    return res.redirect(301, `https://relayop.xyz${req.originalUrl}`);
  }
  next();
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  // The HLS proxy has its own playback-sized bucket below. Counting its
  // playlist polls here too would 429 a live stream after ~30s of watching —
  // every mounted limiter on the path counts the same request.
  skip: (req) => req.originalUrl.startsWith("/api/stream/proxy"),
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
app.use("/api/og", heavyLimiter);
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

app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && res.statusCode >= 400) {
        const errorSnippet = JSON.stringify(capturedJsonResponse).slice(0, 200);
        logLine += ` :: ${errorSnippet}`;
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    // Don't leak internal error details on 5xx; only surface explicit client (4xx) messages.
    const message = status >= 500 ? "Internal Server Error" : (err.message || "Request error");
    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      // SO_REUSEPORT is unsupported on macOS (listen() throws ENOTSUP); only enable it on Linux.
      ...(process.platform === "linux" ? { reusePort: true } : {}),
    },
    () => {
      log(`serving on port ${port}`);
      startScheduler();
    },
  );
})();
