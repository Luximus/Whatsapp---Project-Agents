import type { ChatMessage } from "../ai/types.js";
const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const buying = (s: string) =>
  !/\b(no quiero|not ready|nao quero|solo informacion|just information)\b/.test(s) &&
  /\b(quiero|deseo|confirmo|voy a|i want to|quero)\s+(contratar|comprar|pagar|buy|purchase|pay|contratarlo)|\b(enviame|dame|send me|manda).{0,35}(enlace de pago|payment link|link de pagamento)\b/.test(
    s
  );
export function advisorPolicy(raw: string, history: ChatMessage[] = []) {
  const s = plain(raw),
    last = plain([...history].reverse().find((m) => m.role === "assistant")?.content ?? "");
  const yes = /^(si|yes|claro|de acuerdo|adelante|ok|sim|please do)[.!\s]*$/.test(s.trim());
  const negative = /\b(no quiero|no necesito|don't want|do not want|nao quero)\s+(?:(?:saber|conocer|ver|see|know)\s+)?(?:los |the )?(precios?|prices?|costs?|valores?)\b|sin precios/.test(s);
  const purchase =
    buying(s) ||
    (yes &&
      /\?/.test(last) &&
      /continu.{0,20}contrat|proced.{0,20}(compr|pag)|proceed.{0,20}(purchas|checkout)|confirm.{0,20}(contrat|compr)/.test(
        last
      ));
  const price =
    !negative &&
    (purchase ||
      /\b(precios?|costos?|cuesta|cuestan|costaria|cuanto (?:vale|cuesta|cuestan|cuestan|sale|cobran)|tarifas?|prices?|pricing|how much|quanto custa|precos?)\b/.test(
        s
      ) ||
      (yes &&
        /\?/.test(last) &&
        /mostrar.{0,12}precios?|conocer.{0,12}precios?|show.{0,12}pric/.test(last)));
  const details =
    /\b(detall\w*|detail\w*|todo|tudo|todos|todas|compar\w*|versus|vs|diferencias?|explica.*completo|everything|all options|all prices|em detalhe)\b/.test(
      s
    );
  const data =
    /@|mi nombre|me llamo|my name|meu nome/.test(s) &&
    history
      .filter((m) => m.role === "user")
      .slice(-8)
      .some((m) => buying(plain(m.content)));
  const followup =
    !/no quiero|not ready|nao quero/.test(s) && !negative &&
    (/\b(quiero|deseo|solicito|agend|i want|quero).{0,30}(cotizacion|presupuesto|demo|reunion|cita|quote|meeting)|\b(cotizame|agendemos)\b/.test(
      s
    ) ||
      purchase ||
      (yes && /\?/.test(last) && /cotizacion|agend|demo|meeting|quote/.test(last)));
  return {
    price,
    details,
    purchase,
    write: purchase || data,
    followup,
    portal: purchase || /\b(enlace|link|portal)\b/.test(s),
    locale: /\b(hello|please|how|what|price|i want|i would)\b/.test(s)
      ? "en"
      : /\b(ola|quero|quanto|preco)\b/.test(s)
        ? "pt"
        : "es"
  };
}
export type AdvisorPolicy = ReturnType<typeof advisorPolicy>;
export const advisorInstructions = `\nREGLAS PRIORITARIAS PARA EL ASESOR DE WHATSAPP (sustituyen mandatos de enumerar, cotizar o cerrar de las secciones anteriores y herramientas):
Actúa como asesora virtual experta y consultiva en TODO el portafolio. Escucha y responde primero la duda concreta. Usa el historial y las observaciones de sitios; una referencia de otra persona no describe necesariamente el negocio del cliente. No preguntes datos ya conocidos.
Normalmente escribe 2–4 frases, 40–80 palabras, sin encabezados ni listas de beneficios. Haz como máximo UNA pregunta útil y solo si ayuda. No cierres siempre con preguntas ni con ofertas de otro plan. No inventes descuentos, resultados, urgencia ni funciones.
El catálogo es una fuente de hechos, NO un encargo de recitarlo. Interés, pedir paquetes o preguntar cómo se contrata NO significa comprar, pedir todos los precios o autorizar un pedido. No adelantes importes ni portal privado sin solicitud pertinente. Si pregunta cuánto cuesta, responde directamente UNA opción adecuada, con período y condiciones esenciales; no lo obligues a un cuestionario. Compara todas las opciones solo cuando lo solicite explícitamente. Si requiere cotización, dilo sin inventar tarifa.
Descubre la necesidad, relaciona uno o dos beneficios y propone un siguiente paso apropiado. No sigas un embudo rígido ni pidas nombre/correo/materiales antes de que sean necesarios. Un saludo recibe un saludo breve y una pregunta abierta, sin enumerar el portafolio. Ante interés en una referencia, aporta un beneficio pertinente y pregunta por la actividad u objetivo que aún falte. No te limites a decir que puedes orientar o que primero resolverás dudas; ayuda en ese mismo mensaje. No adelantes trámites administrativos ni anuncies el portal como parte de una presentación. Acepta juntos los datos que ofrezca voluntariamente. El soporte y las quejas se atienden sin discurso comercial; transfiere a humano cuando lo pida.
Contrata únicamente por instrucción clara o confirmación inequívoca de la última propuesta; seleccionar duración no equivale a compra. Antes de pagar informa importe, período y condiciones esenciales. Nunca ocultes compromisos por brevedad. Los estados de pago se confirman con herramientas. No crees pedidos para consultas iniciales.
Responde en el idioma del mensaje ORIGINAL. Conserva tu identidad virtual honesta y no repitas presentaciones. El menú solo se muestra cuando se solicita.\n`;
const money = (s: string) =>
  /\$\s*\d|\b\d[\d.,\s]*\s*(?:COP|USD|pesos|dolares)\b|(?:COP|USD)\s*\d/i.test(s);
export function advisorViolation(text: string, p: AdvisorPolicy) {
  const periods = new Set([...text.matchAll(/\b(1|3|6|12)\s*(?:mes(?:es)?|months?)\b/gi)].map(m=>m[1]));
  const plans = new Set([...text.matchAll(/\b(Plus|Premium|Free)\b/gi)].map(m=>m[1]!.toLowerCase()));
  const amounts = text.match(/\$\s*\d[\d.,]*|\b(?:COP|USD)\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:COP|USD|pesos)\b/gi) ?? [];
  return (!p.price && money(text)) || (!p.portal && /website-sales\/portal\//.test(text)) ||
    (!p.details && (text.split(/\s+/).length > 110 || (amounts.length>1 && (periods.size>1 || plans.size>1))));
}

export function advisorToolAllowed(name: string, args: Record<string, unknown>, p: AdvisorPolicy) {
  if (name === "websitePageSales" && ["start", "save"].includes(String(args.action)))
    return p.write;
  if (["captureCommercialLead", "scheduleMeeting"].includes(name)) return p.followup;
  return true;
}
export function advisorToolResult(name: string, result: string, p: AdvisorPolicy) {
  if (!["websitePageSales", "getServiceCatalog"].includes(name)) return result;
  try {
    const data = JSON.parse(result);
    const clean = (v: any): any =>
      Array.isArray(v)
        ? v.map(clean)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v)
                .filter(([k]) => k !== "instructions" && (p.portal || k !== "portalUrl"))
                .map(([k, v]) => [k, clean(v)])
            )
          : v;
    return JSON.stringify(clean(data));
  } catch {
    return result;
  }
}
export function advisorFallback(text: string, p: AdvisorPolicy) {
  const safe = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(
      (s) =>
        s.trim() &&
        s.split(/\s+/).length < 35 &&
        !money(s) &&
        !/https?:|website-sales\/portal/.test(s)
    )
    .slice(0, 2)
    .join(" ");
  return (
    safe ||
    {
      es: "Puedo orientarte sobre esa solicitud. ¿Qué aspecto te interesa aclarar primero?",
      en: "I can help with that request. Which aspect would you like to clarify first?",
      pt: "Posso ajudar com essa solicitação. Qual aspecto você gostaria de esclarecer primeiro?"
    }[p.locale as "es" | "en" | "pt"]
  );
}
