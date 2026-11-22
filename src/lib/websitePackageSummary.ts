import { z } from "zod";
import type { AdvisorPolicy } from "./agents/advisorPolicy.js";

const cloneTopic = /\b(?:clon virtual|clones virtuales|jmarin\.luxisoft\.com)\b/i;
const relativeQuestion =
  /^(?:(?:y|entonces|pero)\s+)?(?:cuanto (?:cuesta|vale|sale)|que (?:incluye|ofrecen)|como funciona|que paquetes (?:hay|tienen)|(?:(?:el|los) )?(?:precios?|paquetes)|(?:mas (?:info|informacion|detalles)|cuentame mas))(?:\s+(?:(?:por|para)\s+)?\d{1,2}\s+mes(?:es)?)?(?: por favor)?$/;

export function websiteCatalogQuestion(raw: string, previousReply: string, policy: AdvisorPolicy) {
  if (
    policy.locale !== "es" ||
    policy.usageInquiry ||
    policy.purchase ||
    policy.followup ||
    policy.aiPlatformInterest
  )
    return null;
  const text = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¿?¡!,;:]/g, " ")
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /\b(?:no (?:quiero|deseo|me interesa) (?:mas )?(?:informacion|info|el clon)|ya pague|mi pedido|mi comprobante)\b/.test(
      text
    )
  )
    return null;
  const relative = cloneTopic.test(previousReply) && (relativeQuestion.test(text) || /mensualidad|despues del primer mes|desde el segundo mes|pago mensual/.test(text));
  if (!cloneTopic.test(text) && !relative) return null;
  const omitPrices =
    /\b(?:sin (?:precios?|costos?)|no (?:quiero|incluyas|menciones|necesito).{0,24}(?:precios?|costos?))\b/.test(
      text
    );
  if (
    !omitPrices &&
    (policy.packagesInquiry || policy.price || (relative && /\bpaquetes\b/.test(text)))
  )
    return "packages";
  // A general product inquiry can use the public catalog. Questions about a specific order,
  // integration or feature still need their own context and tools.
  const subject = text
    .replace(cloneTopic, "producto")
    .replace(/ de luxisoft\b/g, "")
    .replace(/ (?:por favor|gracias)$/, "")
    .replace(/\s+sin (?:precios?|costos?).*$/, "");
  const overview =
    /\b(?:informacion|info|detalles|cuentame|hablame|saber(?: mas)?|conocer(?: mas)?|como funciona|que incluye|que es|me interesa)(?: (?:acerca|sobre|de|del|el|un|mi|tu|su|ese|este|servicio|mas))* producto$/.test(
      subject
    ) ||
    /\bproducto (?:y )?(?:que incluye|como funciona|que es|mas informacion|mas detalles)$/.test(
      subject
    ) ||
    /^(?:el |mi |un )?producto$/.test(subject);
  return relative || overview ? "overview" : null;
}

const offer = z.object({
  code: z.literal("page-like-this"),
  currency: z.literal("COP"),
  monthlyCop: z.number().int().positive().optional(),
  packages: z
    .array(
      z.object({
        months: z.number().int().positive(),
        totalCop: z.number().int().positive(),
        discountPercent: z.number().int().min(0).max(100).optional()
      })
    )
    .nonempty(),
  benefits: z.array(z.string().min(1)).nonempty(),
  excluded: z.array(z.string()),
  deliveryBusinessDays: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  startsAt: z.literal("delivery"),
  autoRenew: z.literal(false)
});

function detailedOffer(
  data: unknown,
  months: number | undefined,
  view: "packages" | "overview"
): string {
  const parsed = offer.safeParse(data);
  if (!parsed.success) return "";
  const {
    packages,
    benefits,
    excluded,
    deliveryBusinessDays: [min, max]
  } = parsed.data;
  const cop = new Intl.NumberFormat("es-CO");
  const list = new Intl.ListFormat("es", { type: "conjunction" });
  const items = (values: string[]) =>
    list.format(values.map((value) => value.charAt(0).toLowerCase() + value.slice(1)));
  if (view === "overview") {
    const extras = benefits.filter((item) => item.toLocaleLowerCase("es") !== "página web");
    return [
      "El clon virtual es una página personalizada para presentar tu negocio o profesión.",
      ...(extras.length ? [`Incluye ${items(extras)}.`] : []),
      `Por este chat recibimos tus materiales. La entrega tarda de ${min} a ${max} días hábiles desde que se confirma el pago y se validan los materiales.`
    ].join(" ");
  }
  const examples = months
    ? packages.filter((p) => p.months === months)
    : packages.filter((p) => [1, 3, 6, 12].includes(p.months));
  if (months && !examples.length) {
    return `El catálogo del clon virtual no ofrece un paquete de ${months} meses. Las duraciones disponibles en meses son ${list.format(packages.map((p) => String(p.months)))}.`;
  }
  const prices = examples
    .map(({ months, totalCop, discountPercent }) => {
      const regularTotal = parsed.data.monthlyCop && months * parsed.data.monthlyCop;
      const saving =
        regularTotal && regularTotal > totalCop
          ? ` (ahorras $${cop.format(regularTotal - totalCop)})`
          : "";
      const discount = discountPercent ? ` con ${discountPercent} % de descuento` : "";
      return `• ${months} ${months === 1 ? "mes" : "meses"} por $${cop.format(totalCop)}${discount}${saving}`;
    })
    .join("\n");
  return [
    `Para crear tu clon virtual, el paquete incluye ${items(benefits)}.`,
    `Todos los paquetes incluyen lo mismo. El precio total en pesos colombianos (COP) depende de la duración.\n${prices}`,
    "Puedes elegir de 1 a 24 meses. Cuando decidas contratar, indícanos la duración aquí. Te pediremos tus datos por chat, verificarás tu correo y recibirás el enlace de Wompi por el total acordado.",
    "Elegiremos contigo la dirección de tu página y revisaremos si está disponible. Podrás enviarnos por aquí una foto, un logo o un documento, y una muestra de tu voz si autorizas su uso.",
    `Con el pago confirmado y los materiales validados, la entrega tarda de ${min} a ${max} días hábiles. El período comienza cuando recibes la página y la renovación es opcional.` +
      (excluded.length ? ` Los extras se cotizan por separado (${items(excluded)}).` : "")
  ].join("\n\n");
}

// Only the authenticated catalog result is passed here, never website or chat text.
export function websitePackageSummary(
  result: string,
  locale: string,
  months?: number,
  view: "packages" | "overview" = "packages"
): string {
  try {
    const data = JSON.parse(result);
    if(locale==="es" && data?.code==="page-like-this"){
      if(data.trmUnavailable && data.initialUsdCents===2599 && data.monthlyUsdCents===999)
        return "El pago inicial del clon virtual es de 25,99 USD e incluye el primer mes. Desde el segundo mes cuesta 9,99 USD al mes. La equivalencia en COP está pendiente de confirmar con la TRM oficial de hoy.";
      if(data.initial?.display && data.monthly?.display && data.trm?.rate){
        const lines=[data.renewal
          ? "Renovar tu página con clon virtual cuesta "+data.monthly.display+" al mes."
          : "Crear tu página web con clon virtual cuesta "+data.initial.display+" e incluye el primer mes. Desde el segundo mes cuesta "+data.monthly.display+" al mes."];
        if(months){
          const item=data.packages.find((entry:{months:number})=>entry.months===months);
          lines.push(item?"Por "+months+" "+(months===1?"mes":"meses")+", el total es "+item.display+".":"Puedes elegir entre 1 y 24 meses.");
        }
        const day = new Intl.DateTimeFormat("es-CO",{timeZone:"America/Bogota",day:"numeric",month:"long",year:"numeric"}).format(new Date());
        lines.push("TRM del "+day+": "+data.trm.rate.toLocaleString("es-CO",{minimumFractionDigits:2})+" COP por USD.");
        if(view==="overview")lines.unshift("El clon virtual es una página personalizada para presentar tu negocio o profesión. Incluye "+data.benefits.join(", ")+".");
        return lines.join(" ");
      }
    }
    if (locale === "es") return detailedOffer(data, months, view);
    if (
      data?.code !== "page-like-this" ||
      !Array.isArray(data.periods) ||
      !data.periods.length ||
      !data.periods.every((n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0)
    )
      return "";
    const periods = new Intl.ListFormat(locale, { type: "disjunction" }).format(
      data.periods.map(String)
    );
    if (locale === "en")
      return `Your website includes a domain for one year. Choose a term of ${periods} months. We collect the details and materials in this chat. After email verification we send the Wompi payment link here.`;
    if (locale === "pt")
      return `A página inclui domínio por um ano. Escolha um período de ${periods} meses. Os dados e materiais são recebidos aqui. Após verificar o e-mail, você recebe neste chat o link de pagamento Wompi.`;
    return "";
  } catch {
    return "";
  }
}
