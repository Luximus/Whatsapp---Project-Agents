import { describe, expect, it } from "vitest";
import { isLearningEligibleMessage, redactLearningText } from "./redact.js";

describe("conversation learning privacy", () => {
  it("redacts contact and secret data before analysis", () => {
    const text = redactLearningText(
      "Escribe a ana@example.com o +57 300 123 4567. token=super-secret código 123456"
    );
    expect(text).not.toContain("ana@example.com");
    expect(text).not.toContain("300 123 4567");
    expect(text).not.toContain("super-secret");
    expect(text).not.toContain("123456");
    expect(text).toContain("[EMAIL]");
    expect(text).toContain("[TELEFONO]");
    expect(text).toContain("[SECRETO]");
    expect(text).toContain("[CODIGO]");
  });

  it("excludes OTP and explicitly sensitive messages", () => {
    expect(isLearningEligibleMessage({ actor: "contact", content: "SOLICITAR CODIGO LUXISOFT REF ABC" })).toBe(false);
    expect(isLearningEligibleMessage({ actor: "ai", content: "Tu código es 123456" })).toBe(false);
    expect(isLearningEligibleMessage({ actor: "human", content: "dato", metadata: { sensitiveFlow: true } })).toBe(false);
  });

  it("keeps useful service messages from contact, AI, and humans", () => {
    for (const actor of ["contact", "ai", "human"] as const) {
      expect(isLearningEligibleMessage({ actor, content: "Necesito ayuda con mi servicio" })).toBe(true);
    }
  });
});
