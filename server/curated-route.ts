/**
 * GET /api/curated: the curated lists the app suggests (starter communities,
 * suggested news feeds), from shared/curated-lists.ts. A fix to a list
 * reaches every user at deploy, an installed app on an older build included.
 */
import { CURATED_LISTS } from "@shared/curated-lists";

export function registerCuratedRoute(app: { get: (path: string, handler: (req: any, res: any) => void) => unknown }): void {
  app.get("/api/curated", (_req, res) => {
    res.set("Cache-Control", "public, max-age=300");
    res.json(CURATED_LISTS);
  });
}
