import cors from "cors";
import type { RequestHandler } from "express";

/**
 * The site's CORS rules (moved from index.ts so a test can run the real
 * order). Our own app and configured origins only — except the call-token
 * service, which answers its own CORS (concord-av.ts: open to other apps'
 * browsers, owner 2026-10-06).
 */
export function siteCors(): RequestHandler {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : [];
  return cors({
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
  });
}
