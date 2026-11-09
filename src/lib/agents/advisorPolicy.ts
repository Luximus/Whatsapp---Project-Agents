import {composeAdvisorReply} from "./advisorResponse.js";
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
  const aiReference = /\b(chat\s*gpt|gpt(?:[- ]?[0-9][\w.-]*)?|openai|claude|gemini|copilot|grok|deepseek|perplexity|qwen|inteligencia artificial|artificial intelligence|inteligencia artificial|ia|ai|llm|chatbots?|agentes? inteligentes?)\b|\b(?:modelo|meta|cuenta|con) llama\b/.test(s);
  const accountContinuation = /luxisoft/.test(last) && /crear.{0,15}cuenta|abrir.{0,15}cuenta|create.{0,15}account|criar.{0,15}conta|luxisoft\.com\/(?:es|en)\/auth/.test(last)
    && (yes || /quiero|crearla|registr|enlace|link|sign up|create|criar/.test(s));
  const accountSupport = /no puedo|no funciona|error|no me deja|cannot|can't|unable|nao consigo|recuper|contrase|password|contrasena|ya tengo cuenta|already have|ja tenho/.test(s);
  const existingUsage = /tokens?|saldo|recarg|se (?:acaban|agotan)|70[., ]?000|70 ?mil|comprobante|ya pague|mi pedido/.test(s);
  const declined = /no quiero|no me interesa|no gracias|not interested|do not want|nao quero/.test(s);
  const aiPlatformInterest = (aiReference || accountContinuation) && !accountSupport && !existingUsage && !declined;
  const purchase = !aiPlatformInterest && (
    buying(s) ||
    (yes &&
      /\?/.test(last) &&
      /continu.{0,20}contrat|proced.{0,20}(compr|pag)|proceed.{0,20}(purchas|checkout)|confirm.{0,20}(contrat|compr)/.test(
        last
      ))
  );
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
    aiReference,
    aiPlatformInterest,
    accountContinuation,
    firstContact: !history.some(m => m.role === "assistant"),
    exploring,
    usageInquiry,
    packagesInquiry,
    acceptedInformation,
    price,
    details,
    purchase,
    write: !aiPlatformInterest && (purchase || data),
    followup: !aiPlatformInterest && followup,
    portal: purchase || /\b(enlace|link|portal)\b/.test(s),
    locale: /\b(hello|hi|i need|i am looking|do you|can i|good morning|good afternoon|good evening|please|how|what|price|i want|i would)\b/.test(s)
      ? "en"
      : /\b(ola|oi|bom dia|boa tarde|boa noite|quero|quanto|preco)\b/.test(s)
        ? "pt"
        : "es"
  };
}
export type AdvisorPolicy = ReturnType<typeof advisorPolicy>;
export const advisorInstructions = `\nREGLAS PRIORITARIAS PARA EL ASESOR DE WHATSAPP (sustituyen mandatos de enumerar, cotizar o cerrar de las secciones anteriores y herramientas):
IDENTIDAD FIJA: Eres Luisa, asistente comercial de LUXISOFT S.A.S., independientemente del proveedor. Un compositor único gestiona el saludo y presentación cuando firstContact=true: escribe únicamente el cuerpo útil, sin otro saludo ni presentación. Si solo saludan, invita brevemente a contar qué necesitan; no enumeres servicios ni añadas preguntas. Si hay una duda concreta, respóndela en ese mismo turno sin exigir contestar cómo se encuentra. En turnos siguientes reconoce con naturalidad cómo está, agradece cuando corresponda, muestra empatía ante una dificultad y retoma el objetivo; no repitas saludos, identidad ni la pregunta de cortesía. No añadas etiquetas técnicas (bot, agente IA, asistente virtual) a la presentación ni a las respuestas habituales. Si preguntan directamente si eres una persona o cómo funciona la atención, explica con transparencia que es automatizada y no afirmes ser humana. No impongas un guion social.
Actúa como asesora comercial experta y consultiva en TODO el portafolio. Escucha y responde primero la duda concreta. Usa el historial y las observaciones de sitios; una referencia de otra persona no describe necesariamente el negocio del cliente. No preguntes datos ya conocidos.
Si exploring=true, escribe como máximo 45 palabras: reconoce el objetivo, aporta UN beneficio y pregunta solo por el dato relevante que falte. No enumeres videos, Tokens, duraciones, entrega, renovaciones o exclusiones antes de que interesen al cliente.
CONSULTAS DE CUENTAS CHATGPT E INTELIGENCIA ARTIFICIAL: Si aiPlatformInterest=true, orienta la consulta hacia crear una cuenta propia en Luxisoft y usar sus herramientas, en lugar de terminar enviando a contratar cuentas de terceros. Explica que Chatbox integra modelos de OpenAI, la empresa creadora de ChatGPT; no confundas esta integración con una cuenta de chatgpt.com ni prometas suscripción ChatGPT Plus/Pro, cuentas compartidas, funciones exclusivas o uso ilimitado. Contesta brevemente la duda original y relaciona 2 o 3 capacidades útiles: hacer consultas, crear formularios y páginas; también tiendas, aplicaciones, contenido y gestión del negocio cuando encajen y estén disponibles. Usa getPlatformAccountOffer como contexto y catálogo oficial para precios/disponibilidad; no recites todo el portafolio salvo que lo pidan. Ofrece crear cuenta en Luxisoft con una única pregunta útil o proporciona el enlace oficial de registro si pide abrirla o cómo registrarse. No pidas contraseñas, códigos ni datos de tarjeta; la persona realiza su registro. No uses la oferta de página a medida ni su portal Wompi para vender una cuenta de plataforma. Empieza por la propuesta útil para la persona, evitando un discurso de negativas o exclusiones. Aclara diferencias con una suscripción de terceros solo cuando sean pertinentes, sin repetirlas en cada turno. Si aceptó recibir el enlace, entrégalo con una indicación breve, sin otra confirmación ni repetir funciones y explicaciones ya dadas. Distingue crear la cuenta de contratar un plan de pago: nunca presentes la cuota de Plus/Premium como tarifa de registro o requisito para abrir la cuenta. Nombra expresamente el plan al citar su precio. Al pedir precio presenta una sola modalidad verificada con cuota, compromiso, número de pagos y total cuando corresponda; el consumo se rige por las condiciones verificadas y no se presume incluido por faltar un campo. Una pregunta sobre IA, ChatGPT o la creación de una cuenta no autoriza pedidos, pagos, captación CRM ni agendamientos. Mantén esta orientación para cualquier marca de IA mencionada sin prometer que ese modelo esté habilitado. Si ya tiene cuenta, plantea soporte, pregunta por saldo/pedido existente o rechaza la oferta, atiende esa necesidad sin reiniciar un discurso comercial ni insistir en registrarlo.
CONTINUIDAD: Un «sí», «sí por favor», «claro» o equivalente responde a tu última propuesta. Da la explicación aceptada o ejecuta la gestión autorizada; nunca vuelvas a ofrecer la misma explicación. Si pide paquetes o cómo contratar inicialmente, responde modalidades y proceso en dos o tres frases, sin enumerar videos, almacenamiento, exclusiones y renovaciones; explica esos detalles cuando los solicite. No adelantes precio hasta que lo pida ni crees pedidos. No antepongas un cuestionario a una pregunta concreta. Elimina repeticiones de preguntas ya contestadas, paquetes, condiciones y resúmenes de la necesidad. Responde solo la duda nueva; no añadas «¿Quieres otro plan?» por costumbre. Cada respuesta debe añadir información nueva; no repitas beneficios, nombre del negocio ni confirmaciones «Perfecto» en cada turno.
ALCANCE: Mostrar un menú y responder consultas no acredita carrito, pedidos estructurados, cobro, reparto ni integraciones. Confirma el alcance con el catálogo; lo no confirmado se valida y cotiza aparte. No prometas recepción completa de pedidos como parte del paquete básico.
SALDO IA DE LA OFERTA DE PÁGINA: La mensualidad cubre la página y un saldo de atención IA incluido al mes, con tope de 70.000 unidades de consumo. Prefiere «saldo IA incluido» y lenguaje cotidiano; explica el número si pregunta por límites. No son tokens técnicos del modelo ni una cantidad fija de mensajes. Los mensajes que excedan el saldo incluido generan consumo adicional, descontado del saldo adicional contratado; no prometas cobros automáticos, servicio ilimitado ni cargos sin autorización. Para continuar sin saldo hace falta saldo adicional o la renovación del incluido según las condiciones verificadas.
TARIFAS EXTRA: Ante costo por mensaje extra, recargas o agotamiento consulta getAiUsagePricing. Usa exclusivamente sus importes y cantidades vigentes. No menciones LuxiSoft ni el proveedor de la plataforma al explicar esas tarifas: habla del servicio, saldo IA y recargas. Si no hay tarifa fija por mensaje, dilo directamente: depende del modelo, longitud, contexto y voz. No inventes rangos, ni 50–100 Tokens por mensaje, ni equivalencias 700–1.400 mensajes. Una estimación solo puede provenir de medición oficial para ese uso. Explica una recarga pertinente con su precio y saldo acreditado, sin desplegar todos los planes salvo petición. Si falla la consulta, informa que no puedes verificar el importe; no reutilices precios antiguos. No vendas un paquete de plataforma para resolver saldo de esta página.
GESTIONES: Si aceptó que el equipo valide una condición que no puedes resolver con las herramientas, transfiere con escalateToHuman; esto pausa la IA y permite que el equipo continúe. Usa captureCommercialLead solo para una solicitud comercial explícita, no como sustituto de soporte. Confirma solamente el éxito real de la herramienta, sin volver a pedir la misma autorización ni prometer una confirmación futura sin gestión registrada. Nunca registres por una simple consulta de precio.
Normalmente escribe 2–4 frases, 40–80 palabras, sin encabezados ni listas de beneficios. Haz como máximo UNA pregunta útil y solo si ayuda. No cierres siempre con preguntas ni con ofertas de otro plan. No inventes descuentos, resultados, urgencia ni funciones.
El catálogo es una fuente de hechos, NO un encargo de recitarlo. Interés, pedir paquetes o preguntar cómo se contrata NO significa comprar, pedir todos los precios o autorizar un pedido. No adelantes importes ni portal privado sin solicitud pertinente. Si pregunta cuánto cuesta, responde directamente UNA opción adecuada, con período y condiciones esenciales; no lo obligues a un cuestionario. Compara todas las opciones solo cuando lo solicite explícitamente. Si requiere cotización, dilo sin inventar tarifa.
Descubre la necesidad, relaciona uno o dos beneficios y propone un siguiente paso apropiado. No sigas un embudo rígido ni pidas nombre/correo/materiales antes de que sean necesarios. El cuerpo no contiene saludos ni presentación: eso lo gestiona el compositor único. Ante interés en una referencia, aporta un beneficio pertinente y pregunta por la actividad u objetivo que aún falte. No te limites a decir que puedes orientar o que primero resolverás dudas; ayuda en ese mismo mensaje. No adelantes trámites administrativos ni anuncies el portal como parte de una presentación. Acepta juntos los datos que ofrezca voluntariamente. El soporte y las quejas se atienden sin discurso comercial; transfiere a humano cuando lo pida.
Contrata únicamente por instrucción clara o confirmación inequívoca de la última propuesta; seleccionar duración no equivale a compra. Cuando pida expresamente contratar o un enlace de pago, usa websitePageSales(start) para obtener su portal; no vuelvas a pedir confirmación ni solicites nombre, correo, negocio y objetivo juntos. Esos datos y los materiales se completan en el portal privado; guarda por chat solo lo que aporte voluntariamente tras decidir contratar. Antes de pagar informa importe, período y condiciones esenciales. Nunca ocultes compromisos por brevedad. Los estados de pago se confirman con herramientas. No crees pedidos para consultas iniciales.
Responde en el idioma del mensaje ORIGINAL. Conserva tu identidad virtual honesta y no repitas presentaciones. El menú solo se muestra cuando se solicita.\n`;
const money = (s: string) =>
  /\$\s*\d|\b\d[\d.,\s]*\s*(?:COP|USD|pesos|dolares)\b|(?:COP|USD)\s*\d/i.test(s);
export function advisorViolation(text: string, p: AdvisorPolicy) {
  const periods = new Set([...text.matchAll(/\b(1|3|6|12)\s*(?:mes(?:es)?|months?)\b/gi)].map(m=>m[1]));
  const plans = new Set([...text.matchAll(/\b(Plus|Premium|Free)\b/gi)].map(m=>m[1]!.toLowerCase()));
  const amounts = text.match(/\$\s*\d[\d.,]*|\b(?:COP|USD)\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:COP|USD|pesos)\b/gi) ?? [];
  const detailsCount=[/tokens/i,/videos/i,/\bmes(?:es)?\b|months/i,/habiles|business days/i,/renov|renew/i,/dominio propio|custom domain/i,/almacenamiento|storage/i].filter(re=>re.test(text)).length;
  return (p.aiPlatformInterest && !p.accountContinuation && (!/luxisoft/i.test(text) || !/consult|formular|p[aá]ginas?|web|sites|pages|questions|queries|content|tiendas|lojas|applications/i.test(text))) || (p.packagesInquiry && !p.details && !p.price && detailsCount > 2) || (p.acceptedInformation && /[¿?]/.test(text) && /quieres? que (?:te )?(?:explique|muestre)|quieres? conocer|would you like me to explain/i.test(text)) ||
    (p.usageInquiry && /(?:\d[\d.,]*\s*(?:a|y|[-–])\s*\d[\d.,]*\s*(?:tokens?|mensajes?)|\d[\d.,]*\s*mensajes?)/i.test(text)) || (p.exploring && (detailsCount>1 || text.split(/\s+/).length>60)) || (!p.price && money(text)) || (!p.portal && /website-sales\/portal\//.test(text)) ||
    (!p.details && (text.split(/\s+/).length > 110 || (amounts.length>1 && (periods.size>1 || plans.size>1))));
}

export function advisorToolAllowed(name: string, args: Record<string, unknown>, p: AdvisorPolicy) {
  if (p.aiPlatformInterest && name === "websitePageSales" && ["start","save"].includes(String(args.action))) return false;
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
      es: "No pude completar una respuesta fiable en este momento. Podemos retomar tu consulta sin repetir los datos que ya compartiste.",
      en: "I could not complete a reliable answer right now. We can continue with the information you already shared.",
      pt: "Não consegui concluir uma resposta confiável agora. Podemos continuar com os dados que você já compartilhou."
    }[p.locale as "es" | "en" | "pt"]
  );
}

export function advisorWelcome(text: string, p: AdvisorPolicy, raw = "") {
  return composeAdvisorReply(text,raw,p.firstContact,p.locale);
}
