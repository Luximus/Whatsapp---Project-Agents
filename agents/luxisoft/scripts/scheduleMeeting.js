/**
 * Tool: agenda una cita/reunión con un especialista de LUXISOFT.
 *
 * Envía la solicitud de agendamiento al equipo comercial por correo (plantilla
 * de agendamiento). La lógica de envío se inyecta vía `context.actions` desde la
 * capa de rutas (webhook); aquí solo validamos y normalizamos los argumentos.
 */
export default {
  name: "scheduleMeeting",
  description:
    "Agenda una cita o reunión con un especialista de LUXISOFT y la envía al equipo comercial. " +
    "Úsala SOLO cuando la persona ya confirmó que quiere agendar y tengas al menos su nombre y un día o fecha tentativa. " +
    "Pide primero los datos que falten (nombre, correo, día/fecha y servicio de interés); no inventes datos.",
  parameters: {
    type: "object",
    properties: {
      contactName: { type: "string", description: "Nombre de la persona de contacto." },
      company: { type: "string", description: "Empresa, si la menciona." },
      contactEmail: {
        type: "string",
        description: "Correo del contacto para enviarle la confirmación."
      },
      meetingDay: { type: "string", description: "Día propuesto (ej. lunes)." },
      meetingDate: { type: "string", description: "Fecha propuesta (ej. 2026-06-02)." },
      meetingTime: {
        type: "string",
        description: "Hora propuesta en la zona del cliente (ej. 10:00)."
      },
      service: {
        type: "string",
        description: "Servicio de interés (luxipanel, luxisoft, licencias, navai...)."
      },
      reason: { type: "string", description: "Motivo o tema de la reunión." }
    },
    required: ["contactName"],
    additionalProperties: false
  },
  async execute(args, context) {
    const schedule = context?.actions?.scheduleMeeting;
    if (typeof schedule !== "function") {
      return "error: agendamiento_no_disponible";
    }

    const contactName = String(args?.contactName ?? "").trim();
    if (!contactName) {
      return "error: falta_nombre_del_contacto";
    }

    const clean = (value) => String(value ?? "").trim();
    const result = await schedule({
      contactName,
      company: clean(args?.company),
      contactEmail: clean(args?.contactEmail),
      meetingDay: clean(args?.meetingDay),
      meetingDate: clean(args?.meetingDate),
      meetingTime: clean(args?.meetingTime) || null,
      service: clean(args?.service),
      reason: clean(args?.reason)
    });

    if (result?.ok) {
      return "ok: cita registrada y enviada al equipo comercial. Confirma a la persona que un especialista la contactará para coordinar los detalles.";
    }
    return `error: no_se_pudo_agendar${result?.message ? `: ${result.message}` : ""}`;
  }
};
