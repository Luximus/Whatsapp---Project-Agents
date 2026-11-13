const cop = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });
const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// El catálogo y su caché conservan centavos. La IA solo ve pesos/dólares ya
// convertidos y su representación: nunca debe hacer esta aritmética.
export function normalizeCatalogMoneyForAgent(value) {
  if (Array.isArray(value)) return value.map(normalizeCatalogMoneyForAgent);
  if (!value || typeof value !== "object") return value;
  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key.endsWith("Cents")) {
      if (typeof entry !== "number" || !Number.isSafeInteger(entry)) continue;
      const currency = /UsdCents$/i.test(key) ? "USD" :
        /CopCents$/i.test(key) || key === "monthlyEquivCents" ? "COP" : null;
      if (!currency) continue;
      const name = key === "monthlyEquivCents" ? "monthlyEquivCop" : key.slice(0, -5);
      const amount = entry / 100;
      normalized[name] = {
        amount,
        currency,
        display: currency === "COP" ? `$${cop.format(amount)} COP` : `US$${usd.format(amount)}`
      };
      if (key === "includedCopCents") normalized.includedAiTokens = {
        amount: entry / 10,
        unit: "Tokens LuxiSoft",
        display: `${cop.format(entry / 10)} Tokens`
      };
      continue;
    }
    normalized[key] = normalizeCatalogMoneyForAgent(entry);
  }
  return normalized;
}

export default {
  name: "getServiceCatalog",
  description: "Consulta información comercial oficial de LUXISOFT o LUXIPANEL, con caché Redis de cinco minutos. Incluye recargas de Tokens LuxiSoft con precio y saldo acreditado. Recomienda según la necesidad e historial antes de citar un precio. Los paquetes de suscripción futuros solo se consultan con includePreview si la persona pregunta por ellos.",
  parameters: {
    type: "object",
    properties: {
      provider: { type: "string", enum: ["luxisoft", "luxipanel"], description: "Proveedor; por defecto luxisoft." },
      area: { type: "string", enum: ["overview", "plans", "engines", "demos"], description: "Información solicitada." },
      planCode: { type: "string", description: "Código de plan devuelto por el catálogo oficial; no inventar." },
      includePreview: { type: "boolean", description: "Solo true si la persona pregunta expresamente por planes futuros o en vista previa. Nunca ofrecerlos como contratables cuando packageProgramActive=false." }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const provider = args?.provider ?? "luxisoft";
    const area = args?.area ?? "overview";
    if (["voz", "navai"].includes(area)) return "NAVAI: proyecto de agentes de voz de LuxiSoft. Implementaciones a medida sujetas a cotización; consultar disponibilidad.";
    if (!["luxisoft", "luxipanel"].includes(provider) || !["overview", "plans", "engines", "demos"].includes(area)) return "error: invalid_catalog_request";
    if (area === "demos") return JSON.stringify({ provider, url: provider === "luxisoft" ? "https://luxisoft.com/es#proyectos" : "https://luxipanel.com", note: "Consultar la selección pública vigente, no afirmar que un proyecto está disponible para contratar sin confirmación." });
    if (provider === "luxipanel" && area === "engines") return "LUXIPANEL: gestión de servidores Linux, WHM/hosting y orientación sobre desarrollo/monetización de software. Consultar disponibilidad específica; no prometer empleos ni ingresos.";
    if (!context?.actions?.getCommercialCatalog) return "catalog_unavailable: no hay conexión al catálogo oficial. No citar precios ni límites; ofrecer reintentar o asesoría.";
    const result = await context.actions.getCommercialCatalog({ provider, area: area === "engines" ? "engines" : "plans" });
    if (result.status !== "ok" || !result.catalog) return "catalog_unavailable: no se pudo comprobar el catálogo vigente. No usar precios recordados ni interpretar el fallo como servicio gratuito.";
    const catalog = result.catalog;
    if (!Number.isFinite(catalog.expiresAt) || catalog.expiresAt <= Date.now()) return 'catalog_unavailable: el catálogo expiró; vuelve a consultar, sin reutilizar precios o capacidades.';
    if(provider==='luxisoft' && !catalog.data.plans?.every(p=>(p.aiUsage??p.customerRole?.aiUsage)?.version===1))return 'catalog_unavailable: no se pudo verificar el contrato de uso semanal vigente.';
    const data = normalizeCatalogMoneyForAgent(catalog.data);
    if (args?.planCode && Array.isArray(data.plans)) data.plans = data.plans.filter(plan => plan.code === args.planCode);
    const requestedPlanAvailable = !args?.planCode || (Array.isArray(data.plans) && data.plans.length > 0);
    if (!requestedPlanAvailable && args?.planCode && Array.isArray(data.previewPackages)) {
      const requestedPreview=data.previewPackages.find(plan=>plan.code===args.planCode);
      if(requestedPreview)data.requestedProfile={code:requestedPreview.code,customerRole:requestedPreview.customerRole??null,purchasable:false,status:'preview'};
    }
    if (args?.includePreview === true && Array.isArray(data.previewPackages)) {
      if (args?.planCode) data.previewPackages = data.previewPackages.filter(plan => plan.code === args.planCode);
    } else delete data.previewPackages;
    return JSON.stringify({
      ...catalog, data, requestedPlanAvailable,
      instructions: [
        "Responder en el idioma de la persona. Los importes ya están convertidos: copiar display, no multiplicar ni dividir. priceCop es el importe por cuota/pago y totalCop el total; months e installments definen periodicidad y número de pagos.",
        "planFamily=packages identifica un programa activo; planFamily=legacy corresponde a las suscripciones actuales cuando packageProgramActive=false. previewPackages son solo información futura: no ofrecerlos como vigentes ni mezclar sus precios, límites o saldo con las suscripciones actuales.",
        "Recomendar primero un plan acorde con la necesidad e historial. Explicar 2–4 servicios o funciones confirmadas para el caso y su utilidad, además de almacenamiento, soporte y facilidad. Si services no existe, no inventar funciones a partir de un código opaco de features.",
        "Citar UNA modalidad pertinente con importe por pago, número de pagos y total; comparar alternativas solo si lo pide sin añadir preguntas ni invitaciones de seguimiento. Describir customerRole.description y customerRole.benefits para explicar los accesos reales del perfil; respetar sus accesos verificados. Luna/Terra/Sol y sus topes de razonamiento provienen de customerRole.policy.models. No suponer que todos los planes tienen las mismas funciones ni inferir modelos por almacenamiento. Los perfiles comerciales no conceden cargos de soporte, moderación o administración de Luxisoft.",
        "Cada plan usa aiUsage version=1 para informar su multiplicador semanal. Free x1, Plus x5, Premium x10, Negocio x15 solo según el catálogo verificado. Renueva cada 7 días desde el primer uso, sin acumular. Ya no existe la asignación de 20.000 Tokens mensuales. El cupo se comunica como uso semanal, no como Tokens comprados. Free permite imágenes nativas y vídeo con IA nativa cuando customerRole.nativeVideo=true. No decir que solo ofrece vídeos de ejemplo. Una recarga aumenta saldo y no desbloquea modelos, voz o integraciones fuera del perfil. Si falta customerRole no inventar sus accesos.",
        "El plan incluye uso semanal. Las recargas son opcionales: primero se consume el cupo semanal y después los Tokens comprados. Una recarga no modifica el porcentaje del cupo, su renovación ni los permisos del plan. No citar campos históricos de saldo incluido como beneficios nuevos.",
        "tokenPackages contiene recargas opcionales para compra única si oneTimeAvailable=true. priceCop es lo que paga la persona, tokens es el saldo LuxiSoft acreditado y balanceCop es su equivalente en COP; no son iguales al precio bruto. La API indica que el precio incluye IVA y que comisión de pago y reserva cambiaria se descuentan antes de acreditar saldo. El complemento mensual solo existe si monthlyAddonProgramActive=true y exige plan pago; no ofrecerlo si está inactivo. No atribuir estos Tokens a una suscripción legacy ni presentar el costo real de IA como tarifa fija: aiUsagePricing depende del proveedor, modelo y TRM. No inventar ahorro, ventas o resultados.",
        "Los planes son suscripciones de plataforma, no la tarifa de integrar únicamente un agente WhatsApp en una web existente. Una lista vacía no significa gratuidad. No convertir campos ausentes en cero ni reutilizar precios previos a fetchedAt."
      ].join(" ")
    });
  }
};
