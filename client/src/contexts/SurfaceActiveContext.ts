import { createContext, useContext } from "react";

/**
 * Is the surface this subtree belongs to currently SHOWING?
 *
 * Almost everything renders only while visible, so the default is true. A
 * kept-alive surface (the Home layer — components/HomeKeepAlive.tsx) stays
 * mounted while hidden, and its descendants must treat the shared scroll
 * container as someone else's while false: scroll events there belong to the
 * page on top, not to the hidden feed.
 */
export const SurfaceActiveContext = createContext(true);

export function useSurfaceActive(): boolean {
  return useContext(SurfaceActiveContext);
}
