/**
 * Which image a feed item gets, and how wide it is. Big outlets carry their
 * story photos in media:content / media:thumbnail (The Guardian: 140px and
 * 460px versions; BBC: a 240px thumbnail), which the feed reader never read,
 * so their stories reached the News page with no picture and no size.
 */
import { describe, expect, it } from "vitest";
import { pickItemImage } from "./rss-image";

describe("pickItemImage", () => {
  it("takes the largest media:content image, with its width", () => {
    const item = {
      mediaContents: [
        { $: { url: "https://i.guim.co.uk/img/story.jpg?width=140", width: "140", medium: "image" } },
        { $: { url: "https://i.guim.co.uk/img/story.jpg?width=460", width: "460", medium: "image" } },
      ],
    };
    expect(pickItemImage(item, {})).toEqual({ url: "https://i.guim.co.uk/img/story.jpg?width=460", width: 460 });
  });

  it("falls back to the largest media:thumbnail, as BBC sends it", () => {
    const bbc = "https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/abc.jpg";
    const item = { mediaThumbnails: [{ $: { url: bbc, width: "240", height: "135" } }] };
    expect(pickItemImage(item, {})).toEqual({ url: bbc, width: 240 });
  });

  it("without media elements, falls back to an image attached to the item, then to the first picture in the article", () => {
    const attached = { enclosure: { url: "https://example.com/story.jpg", type: "image/jpeg" } };
    expect(pickItemImage(attached, {})).toEqual({ url: "https://example.com/story.jpg" });
    const inArticle = { content: '<p>Intro</p><img src="https://example.com/inline.jpg" alt="">' };
    expect(pickItemImage(inArticle, {})).toEqual({ url: "https://example.com/inline.jpg" });
  });
});
