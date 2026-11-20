import type { ChatMessage } from "./ai/types.js";

type BillingCall = (input: Record<string, unknown>) => Promise<unknown>;
const purchase =
  /\b(?:comprar|contratar|adquirir|recargar|renovar|pagar|buy|purchase|renew|top up|quero comprar)\b/i;
const product =
  /\b(?:tokens?|plan(?:es)?|plus|premium|business|zadarma|dominios?|domain|n[uú]mero virtual)\b/i;
const clone = /\b(?:clon|jmarin|website-sales)\b/i;
const identity =
  "Para continuar la compra por WhatsApp, escribe tu nombre completo y tu correo en un solo mensaje.";
const confirmationReminder = "Cuando termines, escribe «ya confirmé» en este chat.";
const emailSent = "Abre el enlace que enviamos a tu correo. " + confirmationReminder;
const labels: Record<string, string> = {
  "company.legalName": "nombre o razón social",
  "contact.email": "correo de facturación",
  "address.countryCode": "país",
  "address.administrativeArea": "departamento o provincia",
  "address.city": "ciudad",
  "address.addressLine1": "dirección",
  "billing.documentType": "tipo de documento fiscal",
  "billing.taxId": "identificación fiscal"
};
function isPurchase(text: string) {
  return (
    purchase.test(text) &&
    product.test(text) &&
    !clone.test(text) &&
    !/(?:no quiero|no deseo|no necesito|solo informaci[oó]n)/i.test(text)
  );
}
export function billingOfferText(r: Record<string, unknown>) {
  return (
    (r.environment === "sandbox" ? "Cotización de prueba. " : "") +
    r.description +
    " · $" +
    Number(r.totalCop).toLocaleString("es-CO") +
    " COP. Para aceptar este total y recibir el enlace de Wompi, responde " +
    r.confirm +
    ". Vence " +
    new Date(String(r.expiresAt)).toLocaleTimeString("es-CO", {
      timeZone: "America/Bogota",
      hour: "2-digit",
      minute: "2-digit"
    }) +
    " (Colombia)."
  );
}
export async function beginBillingConversation(
  raw: string,
  history: ChatMessage[],
  call: BillingCall,
  activeWebsitePurchase = false
) {
  const last = history.filter((x) => x.role === "assistant").at(-1)?.content ?? "";
  const askedIdentity = last.includes(identity),
    awaitingEmail = last.includes(confirmationReminder);
  const resume = awaitingEmail && /confirm|verifi|listo|hecho/i.test(raw);
  const recentRequest = history.filter((message) => message.role === "user").at(-1)?.content ?? "";
  const websiteContext =
    activeWebsitePurchase || clone.test(recentRequest) || /clon virtual/i.test(last);
  const explicitPlatform = /\b(?:tokens?|plus|premium|business|zadarma|plataforma|cuenta)\b/i.test(
    raw
  );
  const initial =
    isPurchase(raw) && (!websiteContext || explicitPlatform || askedIdentity || awaitingEmail);
  if (!initial && !askedIdentity && !resume) return null;
  if (/cancel|no quiero|otra cosa/i.test(raw)) return null;
  const ask = async (args: Record<string, unknown>) =>
    (await call(args)) as Record<string, unknown>;
  const status = await ask({ action: "status" });
  if (status.status === "billing_unavailable")
    return {
      message:
        "En este momento no pude consultar la facturación. Puedes retomar esta compra por aquí."
    };
  if (status.status === "verify_identity") {
    if (askedIdentity) {
      const email = raw.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0];
      const name = raw
        .replace(email ?? "", "")
        .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
        .trim();
      if (email && /^[\p{L}][\p{L}\s'.-]{1,119}$/u.test(name)) {
        const sent = await ask({ action: "identify", name, email });
        if (sent.status === "check_email") return { message: emailSent };
      }
    }
    return {
      message: resume
        ? "Todavía falta confirmar el enlace del correo. " + confirmationReminder
        : identity
    };
  }
  const wanted = initial
    ? raw
    : (history.filter((x) => x.role === "user" && isPurchase(x.content)).at(-1)?.content ?? raw);
  if (Array.isArray(status.missing) && status.missing.length)
    return {
      hint:
        "Perfil verificado. Faltan solo " +
        status.missing.map((k) => labels[String(k)] ?? k).join(", ") +
        ". Solicita los datos necesarios y usa chatBilling(profile). Ofrece el perfil privado para la identificación fiscal.",
      request: wanted
    };
  const tokens = wanted.match(/\b(\d[\d.,]*)\s*tokens?\b/i);
  const plan = wanted.match(/\b(plus|premium|business)\b/i)?.[1]?.toLowerCase();
  const period = /\b(bienal|2 a[nñ]os)\b/i.test(wanted)
    ? "y2"
    : /\b(anual|1 a[nñ]o|12 meses)\b/i.test(wanted)
      ? "y1"
      : /\b(semestral|6 meses)\b/i.test(wanted)
        ? "m6"
        : /\b(trimestral|3 meses)\b/i.test(wanted)
          ? "m3"
          : /\b(mensual|1 mes|un mes)\b/i.test(wanted)
            ? "m1"
            : null;
  const selection =
    tokens && /^\d+(?:[.,]\d{3})*$/.test(tokens[1])
      ? { product: "tokens", tokens: Number(tokens[1].replace(/[.,]/g, "")) }
      : plan && period
        ? { product: "plan", plan, period }
        : null;
  if (selection) {
    const offer = await ask({ action: "quote", selection });
    if (offer.status === "offer") return { message: billingOfferText(offer) };
    return {
      hint:
        "Resultado real de la cotización: " +
        String(offer.status) +
        ". Explica el requisito o el error de esta compra.",
      request: wanted
    };
  }
  return {
    hint: "Compra de cuenta verificada. Usa chatBilling para elegir, cotizar y continuar el producto solicitado.",
    request: wanted
  };
}
