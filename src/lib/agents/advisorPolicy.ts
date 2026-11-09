import type { ChatMessage } from "../ai/types.js";
const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const buying = (s: string) =>
  !/\b(no quiero|not ready|nao quero|no ahora|espera|cancela|mejor no|not now|cancel|olvidalo|no me interesa|no gracias|solo informacion|just information)\b/.test(s) &&
  /\b(quiero|deseo|confirmo|voy a|i want to|quero)\s+(contratar|comprar|pagar|buy|purchase|pay|contratarlo)|\b(enviame|dame|send me|manda).{0,35}(enlace de pago|payment link|link de pagamento)\b/.test(
    s
  );
export function advisorPolicy(raw: string, history: ChatMessage[] = []) {
  const s = plain(raw),
    last = plain([...history].reverse().find((m) => m.role === "assistant")?.content ?? "");
  const yes = /^(si|yes|claro|de acuerdo|adelante|ok|sim|please do)(?:[,\s]+(?:por favor|please|por gentileza))?[.!\s]*$/.test(s.trim());
  const negative = /\b(no quiero|no necesito|don't want|do not want|nao quero)\s+(?:(?:saber|conocer|ver|see|know)\s+)?(?:los |the )?(precios?|prices?|costs?|valores?)\b|sin precios/.test(s);
  const purchase =
    buying(s) ||
    (yes &&
      /\?/.test(last) &&
      /continu.{0,20}contrat|proced.{0,20}(compr|pag)|proceed.{0,20}(purchas|checkout)|confirm.{0,20}(contrat|compr)/.test(
        last
      ));
  const usageInquiry = /tokens?|saldo|recarg|extra|consum|mensajes?|messages?|balance|top.?up/.test(s) || (/cuantos|aproximad|numero|se acaban|se agotan|how many|run out/.test(s) && /tokens?|saldo|consum|mensajes?|messages?|balance/.test(last));
  const packagesInquiry = /paquetes|packages|como contratar|how to sign up/.test(s);
  const acceptedInformation = yes && /explic|mostrar|muestre|conocer|duracion|paquetes|opciones|valid|confirm|equipo|explain|show|options|team/.test(last);
  const price =
    !negative &&
    (purchase ||
      /\b(precios?|costos?|cuesta|cuestan|costaria|cuanto (?:vale|cuesta|cuestan|cuestan|sale|cobran)|tarifas?|prices?|pricing|how much|quanto custa|precos?)\b/.test(
        s
      ) ||
      (yes &&
        /\?/.test(last) &&
        /mostrar.{0,12}precios?|conocer.{0,12}precios?|show.{0,12}pric|cuesta|costos?|valor|recarga/.test(last)));
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
      (yes && /cotizacion|agend|demo|meeting|quote|valid.{0,40}equipo|confirm.{0,40}condicion|consult.{0,40}equipo/.test(last)));
  const exploring = !usageInquiry && !acceptedInformation && !/paquetes|packages|como contratar|how to sign up/.test(s) && !price && !details && !purchase && !/incluy|inclu|benefici|benefit|entrega|deliver|cuando|when|prazo|plazo|renov|vigencia|hosting|tokens?|videos?|voz|voice|soporte|support|no puedo|cannot/.test(s);
  return {
    firstContact: !history.some(m => m.role === "assistant"),
    exploring,
    usageInquiry,
    packagesInquiry,
    acceptedInformation,
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
IDENTIDAD FIJA: Eres Luisa, asistente comercial virtual de LUXISOFT S.A.S., independientemente del proveedor. El servidor antepone el saludo, presentación y pregunta de cortesía una sola vez si firstContact=true: escribe únicamente el cuerpo útil, sin otro saludo ni presentación. Si solo saludan, invita brevemente a contar qué necesitan; no enumeres servicios ni añadas preguntas. Si hay una duda concreta, respóndela en ese mismo turno sin exigir contestar cómo se encuentra. En turnos siguientes reconoce con naturalidad cómo está, agradece cuando corresponda, muestra empatía ante una dificultad y retoma el objetivo; no repitas saludos, identidad ni la pregunta de cortesía. No finjas ser humana ni impongas un guion social.
Actúa como asesora virtual experta y consultiva en TODO el portafolio. Escucha y responde primero la duda concreta. Usa el historial y las observaciones de sitios; una referencia de otra persona no describe necesariamente el negocio del cliente. No preguntes datos ya conocidos.
Si exploring=true, escribe como máximo 45 palabras: reconoce el objetivo, aporta UN beneficio y pregunta solo por el dato relevante que falte. No enumeres videos, Tokens, duraciones, entrega, renovaciones o exclusiones antes de que interesen al cliente.
CONTINUIDAD: Un «sí», «sí por favor», «claro» o equivalente responde a tu última propuesta. Da la explicación aceptada o ejecuta la gestión autorizada; nunca vuelvas a ofrecer la misma explicación. Si pide paquetes o cómo contratar inicialmente, responde modalidades y proceso en dos o tres frases, sin enumerar videos, almacenamiento, exclusiones y renovaciones; explica esos detalles cuando los solicite. No adelantes precio hasta que lo pida ni crees pedidos. No antepongas un cuestionario a una pregunta concreta. Cada respuesta debe añadir información nueva; no repitas beneficios, nombre del negocio ni confirmaciones «Perfecto» en cada turno.
ALCANCE: Mostrar un menú y responder consultas no acredita carrito, pedidos estructurados, cobro, reparto ni integraciones. Confirma el alcance con el catálogo; lo no confirmado se valida y cotiza aparte. No prometas recepción completa de pedidos como parte del paquete básico.
SALDO IA DE LA OFERTA DE PÁGINA: La mensualidad cubre la página y un saldo de atención IA incluido al mes, con tope de 70.000 unidades de consumo. Prefiere «saldo IA incluido» y lenguaje cotidiano; explica el número si pregunta por límites. No son tokens técnicos del modelo ni una cantidad fija de mensajes. Los mensajes que excedan el saldo incluido generan consumo adicional, descontado del saldo adicional contratado; no prometas cobros automáticos, servicio ilimitado ni cargos sin autorización. Para continuar sin saldo hace falta saldo adicional o la renovación del incluido según las condiciones verificadas.
TARIFAS EXTRA: Ante costo por mensaje extra, recargas o agotamiento consulta getAiUsagePricing. Usa exclusivamente sus importes y cantidades vigentes. No menciones LuxiSoft ni el proveedor de la plataforma al explicar esas tarifas: habla del servicio, saldo IA y recargas. Si no hay tarifa fija por mensaje, dilo directamente: depende del modelo, longitud, contexto y voz. No inventes rangos, ni 50–100 Tokens por mensaje, ni equivalencias 700–1.400 mensajes. Una estimación solo puede provenir de medición oficial para ese uso. Explica una recarga pertinente con su precio y saldo acreditado, sin desplegar todos los planes salvo petición. Si falla la consulta, informa que no puedes verificar el importe; no reutilices precios antiguos. No vendas un paquete de plataforma para resolver saldo de esta página.
GESTIONES: Si aceptó que el equipo valide una condición que no puedes resolver con las herramientas, transfiere con escalateToHuman; esto pausa la IA y permite que el equipo continúe. Usa captureCommercialLead solo para una solicitud comercial explícita, no como sustituto de soporte. Confirma solamente el éxito real de la herramienta, sin volver a pedir la misma autorización ni prometer una confirmación futura sin gestión registrada. Nunca registres por una simple consulta de precio.
Normalmente escribe 2–4 frases, 40–80 palabras, sin encabezados ni listas de beneficios. Haz como máximo UNA pregunta útil y solo si ayuda. No cierres siempre con preguntas ni con ofertas de otro plan. No inventes descuentos, resultados, urgencia ni funciones.
El catálogo es una fuente de hechos, NO un encargo de recitarlo. Interés, pedir paquetes o preguntar cómo se contrata NO significa comprar, pedir todos los precios o autorizar un pedido. No adelantes importes ni portal privado sin solicitud pertinente. Si pregunta cuánto cuesta, responde directamente UNA opción adecuada, con período y condiciones esenciales; no lo obligues a un cuestionario. Compara todas las opciones solo cuando lo solicite explícitamente. Si requiere cotización, dilo sin inventar tarifa.
Descubre la necesidad, relaciona uno o dos beneficios y propone un siguiente paso apropiado. No sigas un embudo rígido ni pidas nombre/correo/materiales antes de que sean necesarios. Un saludo recibe un saludo breve y una pregunta abierta, sin enumerar el portafolio. Ante interés en una referencia, aporta un beneficio pertinente y pregunta por la actividad u objetivo que aún falte. No te limites a decir que puedes orientar o que primero resolverás dudas; ayuda en ese mismo mensaje. No adelantes trámites administrativos ni anuncies el portal como parte de una presentación. Acepta juntos los datos que ofrezca voluntariamente. El soporte y las quejas se atienden sin discurso comercial; transfiere a humano cuando lo pida.
Contrata únicamente por instrucción clara o confirmación inequívoca de la última propuesta; seleccionar duración no equivale a compra. Cuando pida expresamente contratar o un enlace de pago, usa websitePageSales(start) para obtener su portal; no vuelvas a pedir confirmación ni solicites nombre, correo, negocio y objetivo juntos. Esos datos y los materiales se completan en el portal privado; guarda por chat solo lo que aporte voluntariamente tras decidir contratar. Antes de pagar informa importe, período y condiciones esenciales. Nunca ocultes compromisos por brevedad. Los estados de pago se confirman con herramientas. No crees pedidos para consultas iniciales.
Responde en el idioma del mensaje ORIGINAL. Conserva tu identidad virtual honesta y no repitas presentaciones. El menú solo se muestra cuando se solicita.\n`;
const money = (s: string) =>
  /\$\s*\d|\b\d[\d.,\s]*\s*(?:COP|USD|pesos|dolares)\b|(?:COP|USD)\s*\d/i.test(s);
export function advisorViolation(text: string, p: AdvisorPolicy) {
  const periods = new Set([...text.matchAll(/\b(1|3|6|12)\s*(?:mes(?:es)?|months?)\b/gi)].map(m=>m[1]));
  const plans = new Set([...text.matchAll(/\b(Plus|Premium|Free)\b/gi)].map(m=>m[1]!.toLowerCase()));
  const amounts = text.match(/\$\s*\d[\d.,]*|\b(?:COP|USD)\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:COP|USD|pesos)\b/gi) ?? [];
  const detailsCount=[/tokens/i,/videos/i,/\bmes(?:es)?\b|months/i,/habiles|business days/i,/renov|renew/i,/dominio propio|custom domain/i,/almacenamiento|storage/i].filter(re=>re.test(text)).length;
  return (p.packagesInquiry && !p.details && !p.price && detailsCount > 2) || (p.acceptedInformation && /[¿?]/.test(text) && /quieres? que (?:te )?(?:explique|muestre)|quieres? conocer|would you like me to explain/i.test(text)) ||
    (p.usageInquiry && /(?:\d[\d.,]*\s*(?:a|y|[-–])\s*\d[\d.,]*\s*(?:tokens?|mensajes?)|\d[\d.,]*\s*mensajes?)/i.test(text)) || (p.exploring && (detailsCount>1 || text.split(/\s+/).length>60)) || (!p.price && money(text)) || (!p.portal && /website-sales\/portal\//.test(text)) ||
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
        !advisorViolation(s,p) && (p.price || !money(s)) &&
        !/https?:|website-sales\/portal/.test(s)
    )
    .slice(0, 2)
    .join(" ");
  return (
    (safe && !advisorViolation(safe,p) ? safe : "") ||
    {
      es: "Puedo orientarte sobre esa solicitud. ¿Qué aspecto te interesa aclarar primero?",
      en: "I can help with that request. Which aspect would you like to clarify first?",
      pt: "Posso ajudar com essa solicitação. Qual aspecto você gostaria de esclarecer primeiro?"
    }[p.locale as "es" | "en" | "pt"]
  );
}

export function advisorWelcome(text: string, p: AdvisorPolicy) {
  if (!p.firstContact) return text;
  const greeting = {
    es: "¡Hola! Soy Luisa, asistente comercial virtual de LUXISOFT S.A.S. ¿Cómo te encuentras?",
    en: "Hello! I'm Luisa, the virtual sales assistant at LUXISOFT S.A.S. How are you?",
    pt: "Olá! Sou Luisa, assistente comercial virtual da LUXISOFT S.A.S. Como você está?"
  }[p.locale as "es" | "en" | "pt"];
  return greeting + "\n\n" + text;
}
