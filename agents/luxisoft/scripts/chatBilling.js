const string = { type: "string" };
export default {
  name: "chatBilling",
  description:
    "Compra en WhatsApp de planes LuxiSoft, Tokens, dominios independientes y números Zadarma. status indica identidad; identify envía verificación con nombre y correo aportados; profile completa datos faltantes; domains/directions/numbers/resources consultan inventario o renovaciones. quote devuelve el total y el comando exacto PAGAR. No solicites documentos de identidad por WhatsApp; si se requieren datos sensibles usa la cuenta privada.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: [
          "status",
          "identify",
          "profile",
          "domains",
          "directions",
          "numbers",
          "resources",
          "quote"
        ]
      },
      name: string,
      email: string,
      country: string,
      domain: string,
      directionId: string,
      search: string,
      profile: {
        type: "object",
        description:
          "Campos de facturación faltantes agrupados en company, contact, address o billing."
      },
      selection: {
        type: "object",
        properties: {
          product: { type: "string", enum: ["plan", "tokens", "domain", "number", "renew"] },
          plan: { type: "string", enum: ["plus", "premium", "business"] },
          period: { type: "string", enum: ["m1", "m3", "m6", "y1", "y2"] },
          tokens: { type: "integer" },
          country: string,
          domain: string,
          directionId: string,
          numberId: string,
          number: string,
          orderId: string,
          documentGroupId: string,
          registrant: {
            type: "object",
            description: "first_name,last_name,email,phone,address,city,state,country,postal_code"
          }
        }
      }
    }
  },
  async execute(args, context) {
    if (!context.actions?.chatBilling) return JSON.stringify({ status: "whatsapp_required" });
    return JSON.stringify(await context.actions.chatBilling(args));
  }
};
