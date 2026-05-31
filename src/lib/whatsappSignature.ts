import crypto from "node:crypto";

/**
 * Verifica la firma `X-Hub-Signature-256` de un webhook de WhatsApp Cloud API.
 *
 * Meta firma el cuerpo crudo (bytes exactos) con HMAC-SHA256 usando el
 * `App Secret` de la app de Meta y lo envía en el header con formato
 * `sha256=<hex>`. La verificación DEBE hacerse sobre el body sin re-serializar,
 * por eso recibimos el buffer crudo.
 *
 * @returns `true` si la firma es válida, `false` en cualquier otro caso.
 */
export function verifyWhatsappSignature(input: {
  appSecret: string;
  rawBody: Buffer;
  signatureHeader: string | undefined | null;
}): boolean {
  const { appSecret, rawBody, signatureHeader } = input;

  if (!appSecret) return false;
  if (typeof signatureHeader !== "string" || !signatureHeader) return false;

  const match = signatureHeader.match(/^sha256=([a-f0-9]+)$/i);
  if (!match) return false;

  const provided = Buffer.from(match[1], "hex");

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest();

  // Longitudes distintas => timingSafeEqual lanzaría; descartamos antes.
  if (provided.length !== expected.length) return false;

  return crypto.timingSafeEqual(provided, expected);
}
