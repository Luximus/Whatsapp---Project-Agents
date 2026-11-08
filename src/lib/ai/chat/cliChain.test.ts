import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderError, type ChatCompletionRequest } from "../types.js";
import {
  buildCliChatPrompt,
  classifyCliFailure,
  CliFallbackChatProvider,
  parseCliChatResult,
  resetCliChatChainForTests,
  type CliChatEngine
} from "./cliChain.js";

const request: ChatCompletionRequest = {
  messages: [
    { role: "system", content: "Eres Luisa" },
    { role: "user", content: "consulta mi cuenta" }
  ],
  tools: [
    {
      name: "getAccountInfo",
      description: "Consulta la cuenta",
      parameters: { type: "object", properties: { service: { type: "string" } } }
    }
  ]
};

function engine(name: CliChatEngine["name"], complete: CliChatEngine["complete"]): CliChatEngine {
  return {
    name,
    model: `${name}-model`,
    provider: name === "claude" ? "anthropic" : "openai",
    available: () => true,
    complete
  };
}

afterEach(() => {
  resetCliChatChainForTests();
  vi.restoreAllMocks();
});

describe("CliFallbackChatProvider", () => {
  it("intenta Codex, luego Qwen y finalmente Claude en ese orden", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const calls: string[] = [];
    const fail = (name: string, statusCode: number) => async () => {
      calls.push(name);
      throw new AiProviderError("openai", `${name}_failed`, { statusCode });
    };
    const engines: CliChatEngine[] = [
      engine("codex", fail("codex", 429)),
      engine("codex-qwen", fail("codex-qwen", 503)),
      engine("claude", async () => {
        calls.push("claude");
        return {
          text: "respuesta",
          toolCalls: [],
          model: "claude-opus-4-8",
          provider: "anthropic"
        };
      })
    ];

    const result = await new CliFallbackChatProvider(engines).complete(request);

    expect(calls).toEqual(["codex", "codex-qwen", "claude"]);
    expect(result.text).toBe("respuesta");
  });

  it("se detiene en Codex cuando el primario responde", async () => {
    const qwen = vi.fn();
    const provider = new CliFallbackChatProvider([
      engine("codex", async () => ({
        text: "ok",
        toolCalls: [],
        model: "gpt-5.6-luna",
        provider: "openai"
      })),
      engine("codex-qwen", qwen)
    ]);

    expect((await provider.complete(request)).text).toBe("ok");
    expect(qwen).not.toHaveBeenCalled();
  });

  it("reintenta el primario tras capacidad agotada sin cambiar el orden de proveedores", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      const provider = new CliFallbackChatProvider([
        engine("codex", async () => {
          calls.push("codex");
          if (calls.filter((name) => name === "codex").length === 1) {
            throw new AiProviderError("openai", "capacity", { statusCode: 503 });
          }
          return { text: "recuperado", toolCalls: [], model: "luna", provider: "openai" };
        }),
        engine("codex-qwen", async () => {
          calls.push("codex-qwen");
          throw new AiProviderError("openai", "denied", { statusCode: 403 });
        }),
        engine("claude", async () => {
          calls.push("claude");
          throw new AiProviderError("anthropic", "expired", { statusCode: 401 });
        })
      ]);
      const answer = provider.complete(request);
      await vi.advanceTimersByTimeAsync(1_500);
      expect((await answer).text).toBe("recuperado");
      expect(calls).toEqual(["codex", "codex-qwen", "claude", "codex"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

it("clasifica capacidad y autenticación sin imprimir detalles del proveedor", () => {
  expect(classifyCliFailure("Selected model is at capacity", false)).toBe(503);
  expect(classifyCliFailure("OAuth session expired and could not be refreshed", false)).toBe(401);
  expect(classifyCliFailure("AccessDenied.Unpurchased 403 Forbidden", false)).toBe(403);
  expect(classifyCliFailure("Too many requests 429", false)).toBe(429);
});

describe("contrato CLI", () => {
  it("incluye prompt, herramientas e idioma en la solicitud", () => {
    const prompt = buildCliChatPrompt(request);
    expect(prompt.system).toContain("Eres Luisa");
    expect(prompt.system).toContain("getAccountInfo");
    expect(prompt.conversation).toContain("consulta mi cuenta");
  });

  it("convierte tool_calls al contrato interno", () => {
    const result = parseCliChatResult(
      '{"type":"tool_calls","calls":[{"name":"getAccountInfo","args_json":"{\\"service\\":\\"lp\\"}"}]}',
      "openai",
      "gpt-5.6-luna"
    );
    expect(result?.toolCalls).toEqual([
      {
        id: "cli_call_1",
        name: "getAccountInfo",
        arguments: '{"service":"lp"}'
      }
    ]);
  });

  it("acepta texto final limpio si el CLI omite el JSON", () => {
    expect(parseCliChatResult("respuesta útil", "anthropic", "opus")?.text).toBe("respuesta útil");
  });
});
