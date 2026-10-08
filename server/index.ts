import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { applyApiLimits } from "./api-limits";
import { PERMISSIONS_POLICY } from "./permissions-policy";
import { serveStatic } from "./static";
import { startScheduler } from "./scheduler";
import { createServer } from "http";
import helmet from "helmet";
import { siteCors } from "./site-cors";
import compression from "compression";

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
        // Dev only: plaintext localhost relays (ws://localhost:PORT and their
        // http:// NIP-11 docs) for testing against a local test relay.
        // Production CSP never includes these.
        ...(process.env.NODE_ENV !== "production"
          ? ["ws://localhost:*", "http://localhost:*", "ws://127.0.0.1:*", "http://127.0.0.1:*"]
          : []),
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
      // Dev is plain http: real WebKit (iPhone Safari, the iOS Simulator)
      // obeys these two and rewrites every module request to https://, so the
      // app never boots there. Chromium exempts localhost, which hid it.
      ...(process.env.NODE_ENV !== "production" ? { upgradeInsecureRequests: null } : {}),
    },
  },
  strictTransportSecurity: process.env.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: false }
    : false,
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
}));

app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    PERMISSIONS_POLICY,
  );
  next();
});

// The site's CORS rules live in site-cors.ts, so concord-av.test.ts can run
// them in the real order ahead of the call-token service's own (open) CORS.
app.use(siteCors());

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

applyApiLimits(app);

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
