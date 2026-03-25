// Adaptado al backend de Node.js desde la version frontend del scraper de texto.
export type ScrapeOptions = {
  dedupe?: boolean;
  minLength?: number;
  onlyVisible?: boolean;
  includeLinkText?: boolean;
  excludeUrlLikeText?: boolean;
};

const SKIP_BLOCKS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "meta",
  "link",
  "head"
];

const BLOCK_TAGS =
  "address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h1|h2|h3|h4|h5|h6|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul";

function normalize(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function isUrlLikeText(text: string) {
  return /^(https?:\/\/|www\.)\S+$/i.test(text) || /^(mailto:|tel:)\S+$/i.test(text);
}

function removeTagBlock(html: string, tagName: string) {
  const regex = new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, "gi");
  return html.replace(regex, " ");
}

function removeHiddenBlocks(html: string) {
  return html.replace(
    /<([a-z0-9]+)\b[^>]*(?:\s+hidden(?:=("[^"]*"|'[^']*'|[^\s>]+))?|\s+aria-hidden\s*=\s*["']?true["']?|\s+style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'])[^>]*>[\s\S]*?<\/\1>/gi,
    " "
  );
}

export function scrapePageTextFromHtml(rawHtml: string, options: ScrapeOptions = {}) {
  const {
    dedupe = true,
    minLength = 2,
    onlyVisible = true,
    includeLinkText = false,
    excludeUrlLikeText = true
  } = options;

  let html = String(rawHtml ?? "");
  if (!html.trim()) return [] as string[];

  for (const tag of SKIP_BLOCKS) {
    html = removeTagBlock(html, tag);
  }

  if (!includeLinkText) {
    html = html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " ");
  } else {
    html = html.replace(/<\/?a\b[^>]*>/gi, " ");
  }

  if (onlyVisible) {
    html = removeHiddenBlocks(html);
  }

  html = html
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]+>/g, " ");

  const text = decodeHtmlEntities(html);
  const output = text
    .split(/\n+/)
    .map((item) => normalize(item))
    .filter((item) => item.length >= minLength)
    .filter((item) => (excludeUrlLikeText ? !isUrlLikeText(item) : true));

  if (!dedupe) return output;

  const seen = new Set<string>();
  return output.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
