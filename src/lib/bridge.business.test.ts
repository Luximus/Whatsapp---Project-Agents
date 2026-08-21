import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetBridgeStores } from "./bridge/factory.js";
import {
  buildBridgeMessage,
  buildBridgeOtpRequest,
  buildBridgeSignature,
  consumeBridgeOtp,
  createBridgeSession,
  extractBridgeReference,
  fulfillBridgeOtpRequest,
  verifyBridgeSessionCode
} from "./bridge.js";

// fastify falso: sin .pg => factory usa el store en memoria (default env).
const fastify = { log: { warn() {}, info() {} } };

describe("bridge business logic (memory store)", () => {
  beforeEach(() => resetBridgeStores());
  afterEach(() => vi.unstubAllGlobals());

  it("crea sesión y la verifica con el código correcto vía OTP entrante", async () => {
    const session = await createBridgeSession(fastify, {
      projectKey: "luxisoft",
      flow: "verification",
      phoneE164: "+573001112233",
      userCode: "123456"
    });
    expect(session.status).toBe("pending");

    // Evitamos la entrega real del callback (fetch) durante consume.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));

    const result = await consumeBridgeOtp(fastify, {
      from: "+573001112233",
      otp: "123456",
      text: "mi codigo es 123456"
    });
    expect(result.handled).toBe(true);
    expect(result.status).toBe("verified");
  });

  it("código incorrecto incrementa attempts y eventualmente expira", async () => {
    await createBridgeSession(fastify, {
      projectKey: "luxisoft",
      flow: "verification",
      phoneE164: "+573009998877",
      userCode: "111111"
    });

    let last;
    for (let i = 0; i < 5; i++) {
      last = await consumeBridgeOtp(fastify, {
        from: "+573009998877",
        otp: "000000",
        text: "000000"
      });
    }
    expect(last?.handled).toBe(true);
    expect(last?.status).toBe("expired");
  });

  it("verifyBridgeSessionCode devuelve not found para sesión inexistente", async () => {
    const res = await verifyBridgeSessionCode(fastify, {
      projectKey: "luxisoft",
      sessionId: "00000000-0000-0000-0000-000000000000",
      code: "123456"
    });
    expect(res.found).toBe(false);
  });

  it("buildBridgeMessage y extractBridgeReference funcionan", () => {
    const msg = buildBridgeMessage("login", "654321", "REF12345");
    expect(msg).toContain("654321");
    expect(msg).toContain("REF12345");
    expect(extractBridgeReference("usa la ref ABCD1234 por favor")).toBe("ABCD1234");
  });

  it("la solicitud iniciada por el usuario solo entrega el OTP al mismo teléfono y referencia", async () => {
    const session = await createBridgeSession(fastify, {
      projectKey: "luxisoft", flow: "verification", phoneE164: "+573001112233", userCode: "123456",
    });
    const text = buildBridgeOtpRequest(session.otp_ref);
    const good = await fulfillBridgeOtpRequest(fastify, { from: "+573001112233", text });
    expect(good.handled).toBe(true);
    expect(good.status).toBe("ready");
    expect(await fulfillBridgeOtpRequest(fastify, { from: "+573009999999", text }))
      .toMatchObject({ handled: true, status: "not_found" });
  });

  it("buildBridgeSignature es estable y verificable", () => {
    const sig = buildBridgeSignature("secret", "1700000000000", '{"a":1}');
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    // Misma entrada -> misma firma.
    expect(buildBridgeSignature("secret", "1700000000000", '{"a":1}')).toBe(sig);
  });
});
