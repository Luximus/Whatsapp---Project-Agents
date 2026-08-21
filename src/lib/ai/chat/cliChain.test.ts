import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderError, type ChatCompletionRequest } from "../types.js";
import {
  buildCliChatPrompt,
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
