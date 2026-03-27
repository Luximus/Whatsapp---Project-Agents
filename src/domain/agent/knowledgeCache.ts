import type {
  CachedKnowledge,
  CrawledKnowledgePage,
  ProjectKnowledgeDictionary,
  ProjectKnowledgeSource
} from "./types.js";
import { scrapePageTextFromHtml } from "../../infrastructure/scraping/textWeb.js";
import {
  KNOWLEDGE_CACHE_TTL_MS,
  MAX_CRAWL_DEPTH,
  MAX_CRAWL_PAGES_PER_SOURCE,
  MAX_GROUNDING_SNIPPETS,
  MAX_PAGE_SNIPPETS,
  MAX_PAGE_TEXT_CHARS,
  MAX_SOURCE_LINKS_PER_PAGE
} from "../../config/constants.js";

const knowledgeCache = new Map<string, CachedKnowledge>();

function normalizeUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const hrefRegex = /href=["']([^"']+)["']/gi;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1]?.trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const resolved = new URL(href, baseUrl).href;
      if (resolved.startsWith("http://") || resolved.startsWith("https://")) {
        links.push(resolved);
      }
    } catch {
      // skip invalid URLs
    }
  }
  return Array.from(new Set(links)).slice(0, MAX_SOURCE_LINKS_PER_PAGE);
}

async function fetchPage(url: string): Promise<CrawledKnowledgePage | null> {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "LuxisoftBot/1.0" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return null;

    const html = await response.text();
    const snippets = scrapePageTextFromHtml(html).slice(0, MAX_PAGE_SNIPPETS);
    const text = snippets.join("\n").slice(0, MAX_PAGE_TEXT_CHARS);
    const links = extractLinksFromHtml(html, url);

    return { sourceUrl: url, raw: html, text, snippets, links };
  } catch {
    return null;
  }
}

async function crawlSource(
  rootUrl: string,
  depth = MAX_CRAWL_DEPTH,
  maxPages = MAX_CRAWL_PAGES_PER_SOURCE
): Promise<CrawledKnowledgePage[]> {
  const visited = new Set<string>();
  const results: CrawledKnowledgePage[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: rootUrl, depth: 0 }];

  while (queue.length && results.length < maxPages) {
    const item = queue.shift();
    if (!item) break;
    const normalized = normalizeUrl(item.url);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    const page = await fetchPage(normalized);
    if (!page) continue;
    results.push(page);

    if (item.depth < depth) {
      const rootOrigin = new URL(rootUrl).origin;
      for (const link of page.links) {
        try {
          const linkOrigin = new URL(link).origin;
          if (linkOrigin === rootOrigin && !visited.has(normalizeUrl(link))) {
            queue.push({ url: link, depth: item.depth + 1 });
          }
        } catch {
          // skip
        }
      }
    }
  }

  return results;
}

function buildDictionary(projectKey: string, pages: CrawledKnowledgePage[]): ProjectKnowledgeDictionary {
  const sources: Record<string, ProjectKnowledgeSource> = {};
  for (const page of pages) {
    sources[page.sourceUrl] = {
      sourceUrl: page.sourceUrl,
      text: page.text,
      snippets: page.snippets,
      links: page.links
    };
  }
  return { projectKey, sources };
}

export async function getOrFetchKnowledge(
  projectKey: string,
  sources: string[]
): Promise<CachedKnowledge> {
  const cached = knowledgeCache.get(projectKey);
  if (cached && Date.now() - cached.loadedAt < KNOWLEDGE_CACHE_TTL_MS) {
    return cached;
  }

  const allPages: CrawledKnowledgePage[] = [];
  for (const sourceUrl of sources) {
    const pages = await crawlSource(sourceUrl);
    allPages.push(...pages);
  }

  const dictionary = buildDictionary(projectKey, allPages);
  const text = allPages.map((p) => p.text).join("\n\n").slice(0, MAX_PAGE_TEXT_CHARS * 3);

  const entry: CachedKnowledge = { loadedAt: Date.now(), text, dictionary };
  knowledgeCache.set(projectKey, entry);
  return entry;
}

export function searchKnowledge(
  cache: CachedKnowledge,
  query: string,
  options?: { sourceUrl?: string }
): string[] {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return [];

  const queryTerms = normalizedQuery.split(/\s+/).filter((t) => t.length > 2);

  let candidateSnippets: string[] = [];

  if (options?.sourceUrl) {
    const source = cache.dictionary.sources[options.sourceUrl];
    if (source) {
      candidateSnippets = source.snippets;
    }
  } else {
    for (const source of Object.values(cache.dictionary.sources)) {
      candidateSnippets.push(...source.snippets);
    }
  }

  const scored = candidateSnippets
    .map((snippet) => {
      const lower = snippet.toLowerCase();
      const matches = queryTerms.filter((term) => lower.includes(term)).length;
      return { snippet, matches };
    })
    .filter((item) => item.matches > 0)
    .sort((a, b) => b.matches - a.matches);

  return scored.slice(0, MAX_GROUNDING_SNIPPETS).map((item) => item.snippet);
}

export function invalidateKnowledgeCache(projectKey: string): void {
  knowledgeCache.delete(projectKey);
}
