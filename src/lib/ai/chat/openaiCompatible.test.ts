import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  getProviderCredentials: () => ({
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    defaultChatModel: "default-model"
  })
}));

import { OpenAiCompatibleChatProvider } from "./openaiCompatible.js";

describe("OpenAiCompatibleChatProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("construye el request y parsea texto + tool calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          model: "gpt-test",
          choices: [
            {
              message: {
                content: "  hola  ",
                tool_calls: [
                  { id: "c1", function: { name: "lookup", arguments: '{"q":1}' } }
                ]
              }
            }
          ]
        })
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiCompatibleChatProvider("openai");
    const result = await provider.complete({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
        { role: "tool", content: "res", toolCallId: "c1" }
      ],
      tools: [{ name: "lookup", description: "d", parameters: { type: "object" } }],
      temperature: 0.5,
      maxTokens: 100
    });

    expect(result.text).toBe("hola");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-test");
    expect(result.toolCalls).toEqual([{ id: "c1", name: "lookup", arguments: '{"q":1}' }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/v1/chat/completions");
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe("default-model");
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "c1", content: "res" });
    expect(body.tools[0].type).toBe("function");
    expect(body.tools[0].function.name).toBe("lookup");
    expect((init as any).headers.authorization).toBe("Bearer test-key");
  });

  it("lanza AiProviderError en respuesta no OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate" })
    );
    const provider = new OpenAiCompatibleChatProvider("grok");
    await expect(provider.complete({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      "grok_chat_failed"
    );
  });
});
