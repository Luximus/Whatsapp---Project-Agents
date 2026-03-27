export default {
  name: "schedule_meeting_request",
  description:
    "Agenda una solicitud de reunion con especialista cuando el caso requiere cotizacion o seguimiento humano y ya estan los datos completos.",
  parameters: {
    type: "object",
    properties: {
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
        description: "Empresa o negocio."
      },
      email: {
        type: "string",
        description: "Correo del contacto."
      },
      meeting_day: {
        type: "string",
        description: "Dia preferido para la reunion."
      },
      meeting_date: {
        type: "string",
        description: "Fecha preferida para la reunion."
      },
      meeting_time: {
        type: "string",
        description: "Hora preferida para la reunion."
      },
      meeting_reason: {
        type: "string",
        description: "Motivo o resumen de la reunion."
      }
    },
    additionalProperties: false
  },
  async run(input, context) {
    if (typeof context?.scheduleMeetingRequest !== "function") {
      return { ok: false, error: "schedule_meeting_request_unavailable" };
    }

    return context.scheduleMeetingRequest(input ?? {});
  }
};
