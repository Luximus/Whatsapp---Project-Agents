export default {
  name: "search_project_knowledge",
  description:
    "Busca informacion del proyecto LuxiChat en fuentes web/locales configuradas y retorna fragmentos relevantes.",
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
    const query = typeof input?.query === "string" ? input.query.trim() : "";
    if (!query) {
      return { ok: false, error: "query_required" };
    }
    const snippets = await context.searchKnowledge(query);
    return {
      ok: true,
      project_key: context.projectKey,
      query,
      snippets
    };
  }
};
