export default {
  name: "reset_case_state",
  description:
    "Reinicia el estado local de un caso cerrado cuando el usuario pide abrir un nuevo ticket, nueva reunion o nueva gestion.",
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description: "Caso a reiniciar: support, project, meeting o all."
      },
      keep_contact_data: {
        type: "boolean",
        description: "Si es true, conserva nombre, empresa y correo ya conocidos."
      }
    },
    additionalProperties: false
  },
  async run(input, context) {
    if (typeof context?.resetCaseState !== "function") {
      return { ok: false, error: "reset_case_state_unavailable" };
    }

    return context.resetCaseState(input ?? {});
  }
};
