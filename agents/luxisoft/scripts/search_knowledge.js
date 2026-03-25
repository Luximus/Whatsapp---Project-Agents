export default {
  name: "search_project_knowledge",
  description:
    "Busca informacion de LuxiSoft en URLs oficiales configuradas y retorna fragmentos relevantes.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Consulta puntual a buscar."
      },
      source_url: {
        type: "string",
        description: "URL oficial especifica a scrapear (opcional)."
      }
    },
    required: ["query"],
    additionalProperties: false
  },
  async run(input, context) {
    const officialSources = Array.isArray(context?.sources) ? context.sources : [];

    const query = typeof input?.query === "string" ? input.query.trim() : "";
    const sourceUrl = typeof input?.source_url === "string" ? input.source_url.trim() : "";
    if (!query) {
      return { ok: false, error: "query_required", official_sources: officialSources };
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
      official_sources: officialSources,
      snippets
    };
  }
};
