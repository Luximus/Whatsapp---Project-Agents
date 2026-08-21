export type RichBlock =
  | { kind: "buttons"; body: string; options: Array<{ id: string; title: string }>; footer?: string }
  | { kind: "list"; body: string; buttonLabel: string; sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }> }
  | { kind: "image"; url: string; caption?: string }
  | { kind: "link"; body: string; label: string; url: string }
  | { kind: "card"; title: string; subtitle?: string; imageUrl?: string; url?: string; buttons?: Array<{ id: string; title: string; url?: string }> };

export function sanitizeRichBlocks(value: unknown): RichBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: RichBlock[] = [];
  for (const raw of value.slice(0, 8)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const kind = String(row.kind ?? "");
    if (kind === "buttons" && typeof row.body === "string" && Array.isArray(row.options)) {
      const options = row.options.slice(0, 13).map((option) => {
        const item = option as Record<string, unknown>;
        return { id: String(item.id ?? "").slice(0, 200), title: String(item.title ?? "").slice(0, 20) };
      }).filter((option) => option.id && option.title);
      if (options.length) blocks.push({ kind, body: row.body.slice(0, 1024), options, ...(typeof row.footer === "string" ? { footer: row.footer.slice(0, 60) } : {}) });
    } else if (kind === "list" && typeof row.body === "string" && typeof row.buttonLabel === "string" && Array.isArray(row.sections)) {
      const sections = row.sections.slice(0, 10).map((section) => {
        const item = section as Record<string, unknown>;
        const rows = Array.isArray(item.rows) ? item.rows.slice(0, 10).map((entry) => {
          const r = entry as Record<string, unknown>;
          return { id: String(r.id ?? "").slice(0, 200), title: String(r.title ?? "").slice(0, 24), ...(typeof r.description === "string" ? { description: r.description.slice(0, 72) } : {}) };
        }).filter((entry) => entry.id && entry.title) : [];
        return { ...(typeof item.title === "string" ? { title: item.title.slice(0, 24) } : {}), rows };
      }).filter((section) => section.rows.length);
      if (sections.length) blocks.push({ kind, body: row.body.slice(0, 1024), buttonLabel: row.buttonLabel.slice(0, 20), sections });
    } else if (kind === "image" && typeof row.url === "string") {
      blocks.push({ kind, url: row.url, ...(typeof row.caption === "string" ? { caption: row.caption.slice(0, 1024) } : {}) });
    } else if (kind === "link" && typeof row.url === "string" && typeof row.label === "string" && typeof row.body === "string") {
      blocks.push({ kind, url: row.url, label: row.label.slice(0, 20), body: row.body.slice(0, 1024) });
    } else if (kind === "card" && typeof row.title === "string") {
      blocks.push({ kind, title: row.title.slice(0, 80), ...(typeof row.subtitle === "string" ? { subtitle: row.subtitle.slice(0, 80) } : {}), ...(typeof row.imageUrl === "string" ? { imageUrl: row.imageUrl } : {}), ...(typeof row.url === "string" ? { url: row.url } : {}) });
    }
  }
  return blocks;
}
