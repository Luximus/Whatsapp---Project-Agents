export default {
  name: "register_support_ticket",
  description:
    "Registra un ticket de soporte cuando el servicio fue con nosotros y ya se tienen nombres, apellidos, empresa, correo y detalle.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "Tema del ticket, por ejemplo soporte, aplicacion o servicio."
      },
      first_name: {
        type: "string",
        description: "Nombre o nombres del contacto."
      },
      last_name: {
        type: "string",
        description: "Apellidos del contacto."
      },
      full_name: {
        type: "string",
        description: "Nombre completo del contacto si se tiene en un solo campo."
      },
      company: {
        type: "string",
        description: "Empresa o negocio del contacto."
      },
      email: {
        type: "string",
        description: "Correo del contacto."
      },
      summary: {
        type: "string",
        description: "Detalle puntual de la solicitud o problema."
      }
    },
    additionalProperties: false
  },
  async run(input, context) {
    if (typeof context?.registerSupportTicket !== "function") {
      return { ok: false, error: "register_support_ticket_unavailable" };
    }

    return context.registerSupportTicket(input ?? {});
  }
};
