import { describe, it, expect } from "vitest";
import { createChatProvider, getDefaultChatProvider } from "./index.js";
import { OpenAiCompatibleChatProvider } from "./openaiCompatible.js";
import { AnthropicChatProvider } from "./anthropic.js";
import { GeminiChatProvider } from "./gemini.js";

describe("createChatProvider", () => {
  it("devuelve el adaptador correcto por proveedor", () => {
    expect(createChatProvider("openai")).toBeInstanceOf(OpenAiCompatibleChatProvider);
    expect(createChatProvider("deepseek")).toBeInstanceOf(OpenAiCompatibleChatProvider);
    expect(createChatProvider("minimax")).toBeInstanceOf(OpenAiCompatibleChatProvider);
    expect(createChatProvider("grok")).toBeInstanceOf(OpenAiCompatibleChatProvider);
    expect(createChatProvider("anthropic")).toBeInstanceOf(AnthropicChatProvider);
    expect(createChatProvider("gemini")).toBeInstanceOf(GeminiChatProvider);
  });

  it("reusa la misma instancia (cache)", () => {
    expect(createChatProvider("openai")).toBe(createChatProvider("openai"));
  });

  it("nombra el proveedor en la instancia", () => {
    expect(createChatProvider("deepseek").name).toBe("deepseek");
  });

  it("getDefaultChatProvider usa openai por defecto", () => {
    expect(getDefaultChatProvider().name).toBe("openai");
  });
});
