/**
 * A bio for its collapsed, three-line view: blank lines squeezed out and each
 * line trimmed, so the lines shown carry words rather than spacing. The full
 * bio ("Show more") keeps the author's own layout.
 */
export function condenseBio(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}
