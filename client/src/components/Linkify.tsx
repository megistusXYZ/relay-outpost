export const URL_REGEX = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?\])}>])/g;

function cleanTrailingPunctuation(url: string): string {
  let cleaned = url;
  const openParens = (cleaned.match(/\(/g) || []).length;
  const closeParens = (cleaned.match(/\)/g) || []).length;
  while (closeParens > openParens && cleaned.endsWith(")")) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}

export function Linkify({ text, className }: { text: string; className?: string }) {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  const regex = new RegExp(URL_REGEX.source, "g");
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rawUrl = match[1];
    const url = cleanTrailingPunctuation(rawUrl);
    const urlEnd = match.index + url.length;
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={className || "text-sky-500 hover:text-sky-400 underline underline-offset-2 break-all"}
        onClick={(e) => e.stopPropagation()}
      >
        {url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
      </a>
    );
    lastIndex = urlEnd;
    regex.lastIndex = urlEnd;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  if (parts.length === 1 && typeof parts[0] === "string") {
    return <>{text}</>;
  }
  return <>{parts}</>;
}
