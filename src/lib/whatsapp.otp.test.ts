import { describe, it, expect } from "vitest";
import { extractOtp, normalizeE164, toWaMeNumber } from "./whatsapp.js";

describe("extractOtp", () => {
  it("extrae el código tras la palabra clave", () => {
    expect(extractOtp("Tu codigo es 123456")).toBe("123456");
    expect(extractOtp("code: 4321")).toBe("4321");
    expect(extractOtp("OTP 9999")).toBe("9999");
  });

  it("usa el fallback de 4-6 dígitos sin palabra clave", () => {
    expect(extractOtp("hola 8765 gracias")).toBe("8765");
  });

  it("devuelve null cuando no hay dígitos válidos", () => {
    expect(extractOtp("hola que tal")).toBeNull();
    expect(extractOtp("")).toBeNull();
    expect(extractOtp(null)).toBeNull();
    expect(extractOtp(undefined)).toBeNull();
  });
});

describe("normalizeE164", () => {
  it("normaliza a formato +<digits>", () => {
    expect(normalizeE164("+57 300 111 2233")).toBe("+573001112233");
    expect(normalizeE164("573001112233")).toBe("+573001112233");
  });

  it("devuelve null para entradas vacías o sin dígitos", () => {
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164("abc")).toBeNull();
    expect(normalizeE164(null)).toBeNull();
  });
});

describe("toWaMeNumber", () => {
  it("quita todo lo que no sea dígito", () => {
    expect(toWaMeNumber("+57 300 111 2233")).toBe("573001112233");
  });
});
