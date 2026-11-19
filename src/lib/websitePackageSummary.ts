import { z } from "zod";

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

function detailedOffer(data: unknown, months?: number): string {
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
  const examples = months
    ? packages.filter((p) => p.months === months)
    : packages.filter((p) => [1, 3, 6, 12].includes(p.months));
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
export function websitePackageSummary(result: string, locale: string, months?: number): string {
  try {
    const data = JSON.parse(result);
    if (locale === "es") return detailedOffer(data, months);
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
