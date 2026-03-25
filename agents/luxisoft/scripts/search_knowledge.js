export default {
  name: "search_project_knowledge",
  description:
    "Busca informacion de LuxiSoft solo en dominios oficiales configurados y retorna fragmentos relevantes.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Consulta puntual a buscar."
      }
    },
    required: ["query"],
    additionalProperties: false
  },
  async run(input, context) {
    const OFFICIAL_DOMAINS = ["luxisoft.com/en/"];

    const query = typeof input?.query === "string" ? input.query.trim() : "";
    if (!query) {
      return { ok: false, error: "query_required", official_domains: OFFICIAL_DOMAINS };
    }

    const snippets = await context.searchKnowledge(query);
    return {
      ok: true,
      project_key: context.projectKey,
      query,
      official_domains: OFFICIAL_DOMAINS,
      snippets
    };
  }
};
