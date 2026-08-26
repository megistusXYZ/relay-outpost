import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.get("/sw.js", (_req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.set("Service-Worker-Allowed", "/");
    res.set("Content-Type", "application/javascript");
    res.sendFile("sw.js", { root: distPath });
  });

  app.get("/manifest.json", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.set("Content-Type", "application/manifest+json");
    res.sendFile("manifest.json", { root: distPath });
  });

  // Content-hashed bundles are immutable: cache them for a year.
  app.use(
    "/assets",
    express.static(path.resolve(distPath, "assets"), {
      immutable: true,
      maxAge: "1y",
    }),
  );

  // Remaining static files. index.html must always revalidate so redeploys
  // propagate to users immediately.
  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    }),
  );

  // fall through to index.html if the file doesn't exist. Registered without a
  // path pattern so no path-to-regexp syntax is involved. sendFile MUST use the
  // root option: with a bare absolute path, send applies its dotfiles="ignore"
  // policy to every segment of the path, so serving from any directory under a
  // dot-dir (e.g. a .claude/worktrees checkout) 404s every fallback response.
  app.use((_req, res) => {
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile("index.html", { root: distPath });
  });
}
