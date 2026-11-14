/** Public pricing only. Never starts a purchase or changes an account balance. */
export default {
  name: "getAiUsagePricing",
  description: "Consulta obligatoria de tarifas vigentes de saldo IA, recargas y consumo de mensajes extra. No hay tarifa fija por mensaje ni equivalencia de saldo a cantidad de mensajes. Devuelve solo precios oficiales sin marcas ni suscripciones de plataforma.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, context) {
    try {
      const result = await context.actions?.getCommercialCatalog?.({ provider: "luxisoft", area: "plans" });
      const snapshot = result?.catalog;
      if (result?.status !== "ok" || !snapshot || !Number.isFinite(snapshot.expiresAt) || snapshot.expiresAt <= Date.now()) {
        return JSON.stringify({ status: "pricing_unavailable" });
      }
      const data = snapshot.data;
      const recharge = data?.aiUsagePricing?.tokenRecharge;
      if (!recharge || !Number.isSafeInteger(recharge.minTokens) || recharge.minTokens<70000 || !Number.isSafeInteger(recharge.minimumPriceCopCents)) return JSON.stringify({status:'pricing_unavailable'});
      return JSON.stringify({ status: "ok", fetchedAt: snapshot.fetchedAt,
        currency: "COP", fixedPricePerMessage: null,
        consumptionBasis: "Costo real según modelo, contexto, longitud y modalidad. Las unidades de saldo no son tokens técnicos del modelo. Sin equivalencia garantizada a mensajes.",
        weeklyPlans:(data.plans??[]).map(p=>({code:p.code,aiUsage:p.aiUsage??p.customerRole?.aiUsage??null})),
        fundingOrder:'Primero el cupo semanal del plan y después los Tokens comprados disponibles, automáticamente; sin compras ni cobros nuevos. No se acumula uso semanal. Las recargas conservan su saldo y sus condiciones.',
        planAccess: 'Recargar Tokens conserva el perfil comercial: los modelos, razonamiento, voz y conexiones dependen del plan, aunque haya saldo. El saldo no equivale a un número fijo de mensajes.',
        recarga: {minimumTokens:recharge.minTokens,minimumPriceCop:recharge.minimumPriceCopCents/100,
          maximum:'Según el tope autorizado de Wompi para el comercio, validado al cotizar.',
          selection:'Deslizador y cantidad exacta; precio confirmado antes del pago.',
          pricingVersion:recharge.pricingVersion,expires:recharge.expires},
        conditions: "El precio se calcula para la cantidad exacta elegida e incluye impuestos y costos de operación. Compra opcional; no activa cobros automáticos." });
    } catch {
      return JSON.stringify({ status: "pricing_unavailable" });
    }
  }
};
