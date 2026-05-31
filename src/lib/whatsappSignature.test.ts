import crypto from "node:crypto";
import { describe, it, expect } from "vitest";
import { verifyWhatsappSignature } from "./whatsappSignature.js";

const APP_SECRET = "test_app_secret";

function sign(secret: string, body: Buffer) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyWhatsappSignature", () => {
  const rawBody = Buffer.from(JSON.stringify({ entry: [{ id: "123" }] }), "utf8");

  it("acepta una firma válida", () => {
    const signatureHeader = sign(APP_SECRET, rawBody);
    expect(
      verifyWhatsappSignature({ appSecret: APP_SECRET, rawBody, signatureHeader })
    ).toBe(true);
  });

  it("rechaza una firma con secreto incorrecto", () => {
    const signatureHeader = sign("otro_secreto", rawBody);
    expect(
      verifyWhatsappSignature({ appSecret: APP_SECRET, rawBody, signatureHeader })
    ).toBe(false);
  });

  it("rechaza cuando el cuerpo fue alterado", () => {
    const signatureHeader = sign(APP_SECRET, rawBody);
    const tampered = Buffer.from(JSON.stringify({ entry: [{ id: "999" }] }), "utf8");
    expect(
      verifyWhatsappSignature({ appSecret: APP_SECRET, rawBody: tampered, signatureHeader })
    ).toBe(false);
  });

  it("rechaza header ausente o mal formado", () => {
    expect(
      verifyWhatsappSignature({ appSecret: APP_SECRET, rawBody, signatureHeader: undefined })
    ).toBe(false);
    expect(
      verifyWhatsappSignature({ appSecret: APP_SECRET, rawBody, signatureHeader: "deadbeef" })
    ).toBe(false);
    expect(
      verifyWhatsappSignature({ appSecret: APP_SECRET, rawBody, signatureHeader: "sha256=zzzz" })
    ).toBe(false);
  });

  it("rechaza cuando no hay app secret configurado", () => {
    const signatureHeader = sign(APP_SECRET, rawBody);
    expect(
      verifyWhatsappSignature({ appSecret: "", rawBody, signatureHeader })
    ).toBe(false);
  });
});
