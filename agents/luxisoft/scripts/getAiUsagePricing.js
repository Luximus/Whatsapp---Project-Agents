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
      const recargas = (data?.tokenPackages ?? []).filter(p => p.oneTimeAvailable === true &&
        Number.isSafeInteger(p.priceCopCents) && p.priceCopCents > 0 &&
        Number.isSafeInteger(p.tokens) && p.tokens > 0 &&
        Number.isSafeInteger(p.balanceCopCents) && p.balanceCopCents > 0)
        .map(p => ({ priceCop: p.priceCopCents / 100, creditedUnits: p.tokens, creditedTokens: p.tokens, unit: "Tokens de saldo",
          creditedBalanceCop: p.balanceCopCents / 100 }));
      if (!recargas.length || !data?.aiUsagePricing) return JSON.stringify({ status: "pricing_unavailable" });
      return JSON.stringify({ status: "ok", fetchedAt: snapshot.fetchedAt,
        currency: "COP", fixedPricePerMessage: null,
        consumptionBasis: "Costo real según modelo, contexto, longitud y modalidad. Las unidades de saldo no son tokens técnicos del modelo. Sin equivalencia garantizada a mensajes.",
        freeAllowance: data.freeAllowance ? {tokens:data.freeAllowance.tokens,renewal:data.freeAllowance.renewal,rollover:data.freeAllowance.rollover,perVerifiedIdentity:data.freeAllowance.perVerifiedIdentity}:null,
        planAccess: 'Recargar Tokens conserva el perfil comercial: los modelos, razonamiento, voz y conexiones dependen del plan, aunque haya saldo. El saldo no equivale a un número fijo de mensajes.',
        recargas,
        conditions: "El precio de compra y el saldo acreditado son distintos: el precio incluye impuestos y se descuentan costos de pago y reserva cambiaria antes de acreditar. Compra opcional; no activa cobros automáticos." });
    } catch {
      return JSON.stringify({ status: "pricing_unavailable" });
    }
  }
};
