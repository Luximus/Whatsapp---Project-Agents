export default {
  name: "register_project_followup",
  description:
    "Registra un seguimiento urgente o solicitud de respuesta humana sobre un proyecto existente usando el contexto actual.",
  parameters: {
    type: "object",
    properties: {
      project_name: {
        type: "string",
        description: "Nombre del proyecto o negocio sobre el que se pide seguimiento."
      },
      summary: {
        type: "string",
        description: "Resumen corto de lo que el usuario necesita que el equipo responda."
      },
      urgency: {
        type: "string",
        description: "Nivel o descripcion de urgencia, por ejemplo urgente o prioritario."
      },
      first_name: {
        type: "string",
        description: "Nombre del contacto si el usuario ya lo compartio."
      },
      last_name: {
        type: "string",
        description: "Apellidos del contacto si el usuario ya los compartio."
      },
      full_name: {
        type: "string",
        description: "Nombre completo del contacto si se tiene en un solo campo."
      },
      company: {
        type: "string",
        description: "Empresa o negocio del contacto si ya se conoce."
      },
      email: {
        type: "string",
        description: "Correo del contacto si ya se conoce."
      }
    },
    additionalProperties: false
  },
  async run(input, context) {
    if (typeof context?.registerProjectFollowup !== "function") {
      return { ok: false, error: "register_project_followup_unavailable" };
    }

    return context.registerProjectFollowup(input ?? {});
  }
};
