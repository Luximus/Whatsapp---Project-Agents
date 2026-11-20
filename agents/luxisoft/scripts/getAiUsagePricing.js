import { normalizeCatalogMoneyForAgent } from "../commercialMoney.js";
/** Public pricing only. Never starts a purchase or changes an account balance. */
export default {
  name: "getAiUsagePricing",
  description: "Consulta obligatoria de tarifas vigentes de saldo IA, recargas y consumo de mensajes extra. No hay tarifa fija por mensaje ni equivalencia de saldo a cantidad de mensajes. Devuelve solo precios oficiales sin marcas ni suscripciones de plataforma.",
  parameters: { type: "object", properties: { tokens: {type:"integer", minimum:70000, maximum:100000000000, description:"Cantidad exacta solicitada"} }, additionalProperties: false },
  async execute(args, context) {
    try {
      const result = await context.actions?.getCommercialCatalog?.({ provider: "luxisoft", area: "plans" });
      const snapshot = result?.catalog;
      if (result?.status !== "ok" || !snapshot || !Number.isFinite(snapshot.expiresAt) || snapshot.expiresAt <= Date.now()) {
        return JSON.stringify({ status: "pricing_unavailable" });
      }
      const data = snapshot.data;
      const recharge = data?.aiUsagePricing?.tokenRecharge;
      if (!recharge || recharge.covered === false || !Number.isSafeInteger(recharge.minTokens) || recharge.minTokens < 70000) return JSON.stringify({status:"pricing_unavailable"});
      let quote = {tokens:recharge.minTokens, priceMicroUsd:recharge.minimumPriceMicroUsd, priceCopCents:recharge.minimumPriceCopCents};
      let trm = data.aiUsagePricing.trm;
      if (args?.tokens !== undefined && args.tokens !== recharge.minTokens) {
        if (!Number.isSafeInteger(args.tokens) || args.tokens < recharge.minTokens || args.tokens > 100000000000) return JSON.stringify({status:"invalid_token_quantity"});
        const base = (process.env.LUXISOFT_PLATFORM_API_URL || "http://127.0.0.1:3200/api/v1").replace(/\/$/, "");
        const response = await fetch(base + "/billing/token-quote?tokens=" + args.tokens, {signal:AbortSignal.timeout(5000)});
        if (!response.ok) return JSON.stringify({status:"pricing_unavailable"});
        const body = await response.json();
        if (!body.ok || body.data?.tokens !== args.tokens) return JSON.stringify({status:"pricing_unavailable"});
        quote = body.data;
        trm = quote.trm;
      }
      if (!(quote.priceMicroUsd > 0 || quote.priceCopCents > 0)) return JSON.stringify({status:"pricing_unavailable"});
      return JSON.stringify({ status: "ok", fetchedAt: snapshot.fetchedAt,
        currency: "COP", fixedPricePerMessage: null,
        consumptionBasis: "Costo real según modelo, contexto, longitud y modalidad. Las unidades de saldo no son tokens técnicos del modelo. Sin equivalencia garantizada a mensajes.",
        weeklyPlans:(data.plans??[]).map(p=>({code:p.code,aiUsage:p.aiUsage??p.customerRole?.aiUsage??null})),
        fundingOrder:'Primero el cupo semanal del plan y después los Tokens comprados disponibles, automáticamente; sin compras ni cobros nuevos. No se acumula uso semanal. Las recargas conservan su saldo y sus condiciones.',
        planAccess: 'Recargar Tokens conserva el perfil comercial: los modelos, razonamiento, voz y conexiones dependen del plan, aunque haya saldo. El saldo no equivale a un número fijo de mensajes.',
        recarga: {minimumTokens:recharge.minTokens,minimumPriceCop:recharge.minimumPriceCopCents > 0 ? recharge.minimumPriceCopCents/100 : null,
          cotizacion:normalizeCatalogMoneyForAgent(quote),trm,
          maximum:'Según el tope autorizado de Wompi para el comercio, validado al cotizar.',
          selection:'Deslizador y cantidad exacta; precio confirmado antes del pago.',
          pricingVersion:recharge.pricingVersion,expires:recharge.expires},
        conditions: "El precio se calcula para la cantidad exacta elegida e incluye impuestos y costos de operación. Compra opcional; no activa cobros automáticos." });
    } catch {
      return JSON.stringify({ status: "pricing_unavailable" });
    }
  }
};
