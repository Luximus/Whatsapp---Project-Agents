import { describe, it, expect } from "vitest";
import { t, DEFAULT_LOCALE } from "./messages.js";
import { detectLocale, resolveLocale } from "./detect.js";

describe("t (traducción)", () => {
  it("devuelve el texto en el locale pedido", () => {
    expect(t("code_verified", "en")).toContain("Code verified");
    expect(t("code_verified", "es")).toContain("Codigo verificado");
    expect(t("code_verified", "pt")).toContain("Codigo verificado. Volte");
  });

  it("hace fallback al idioma por defecto para locale desconocido", () => {
    // @ts-expect-error probamos un locale inválido a propósito
    expect(t("code_verified", "xx")).toBe(t("code_verified", DEFAULT_LOCALE));
  });
});

describe("detectLocale", () => {
  it("detecta inglés", () => {
    expect(detectLocale("hello, I need help with the code")).toBe("en");
  });
  it("detecta portugués", () => {
    expect(detectLocale("ola, preciso de ajuda por favor")).toBe("pt");
  });
  it("cae a español por defecto", () => {
    expect(detectLocale("hola necesito ayuda")).toBe("es");
    expect(detectLocale("")).toBe("es");
    expect(detectLocale(null)).toBe("es");
  });
});

describe("resolveLocale", () => {
  it("prefiere el locale explícito válido", () => {
    expect(resolveLocale({ explicit: "en", text: "ola" })).toBe("en");
  });
  it("ignora explícito inválido y detecta del texto", () => {
    expect(resolveLocale({ explicit: "zz", text: "hello the code" })).toBe("en");
  });
});
