export default {
  name: "scrape_project_knowledge",
  description:
    "Hace scraping de texto en fuentes oficiales del proyecto y retorna fragmentos confirmados para responder con precision.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Consulta puntual a validar con informacion oficial."
      },
      source_url: {
        type: "string",
        description: "URL oficial especifica a consultar (opcional)."
      },
      max_snippets: {
        type: "number",
        description: "Cantidad maxima de fragmentos a devolver (1-10)."
      }
    },
    required: ["query"],
    additionalProperties: false
  },
  async run(input, context) {
    const query = typeof input?.query === "string" ? input.query.trim() : "";
    const sourceUrl = typeof input?.source_url === "string" ? input.source_url.trim() : "";
    const rawMax = Number(input?.max_snippets ?? 6);
    const maxSnippets = Number.isFinite(rawMax)
      ? Math.max(1, Math.min(10, Math.trunc(rawMax)))
      : 6;

    if (!query) {
      return {
        ok: false,
        error: "query_required",
        official_sources: Array.isArray(context?.sources) ? context.sources : []
      };
    }

    const snippets = await context.searchKnowledge(
      query,
      sourceUrl ? { sourceUrl } : undefined
    );

    return {
      ok: true,
      project_key: context.projectKey,
      query,
      source_url: sourceUrl || null,
      snippets: snippets.slice(0, maxSnippets),
      official_sources: Array.isArray(context?.sources) ? context.sources : []
    };
  }
};
