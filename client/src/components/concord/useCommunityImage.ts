/**
 * A group's encrypted photo (the spec's `icon`) as something an <img> can show:
 * a local URL once it has been fetched, opened and checked against its hash,
 * undefined until then or if it never opens. Callers fall back to the plain
 * `picture`, then initials, so nothing broken ever shows.
 */
import { useEffect, useState } from "react";
import { peekCommunityImage, resolveCommunityImage, type CommunityImage } from "@/lib/concord/concord-image";

export function useCommunityImage(image: CommunityImage | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(() => (image ? peekCommunityImage(image) : undefined));
  // The hash names the image; the url is where it's fetched from.
  const id = image ? `${image.hash}|${image.url}` : "";
  useEffect(() => {
    if (!image) { setUrl(undefined); return; }
    let live = true;
    setUrl(peekCommunityImage(image));
    void resolveCommunityImage(image).then((u) => { if (live) setUrl(u ?? undefined); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `id` covers every field that changes the image
  }, [id]);
  return url;
}
