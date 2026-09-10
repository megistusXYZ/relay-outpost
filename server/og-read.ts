/**
 * Does the link-preview fetch read past </head> for this URL?
 *
 * OpenGraph tags live in <head>, so by default the reader stops there and
 * never pulls a multi-MB page. Pages about audio are the exception, because
 * they tend to carry their player only in the body: podcast episode pages (an
 * <audio> element, embedded JS state) and live-radio pages (Bowl After Bowl's
 * /live/ page links its station ~11.6KB in, past a 2KB head). The read is
 * still capped at the same size either way. See og-read.test.ts.
 */
const AUDIO_PAGE = /episod|podcast|\/live\b|radio|listen|stream/i;

export function ogReadsBody(url: string): boolean {
  return AUDIO_PAGE.test(url);
}
