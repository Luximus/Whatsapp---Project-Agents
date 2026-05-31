import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  getProviderCredentials: () => ({
    apiKey: "ak",
    baseUrl: "https://anthropic.test",
    defaultChatModel: "claude-test"
  })
}));

import { AnthropicChatProvider } from "./anthropic.js";

describe("AnthropicChatProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("separa system, mapea tool_result y parsea bloques", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          model: "claude-test",
          content: [
            { type: "text", text: "respuesta" },
            { type: "tool_use", id: "t1", name: "search", input: { q: "x" } }
          ]
        })
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new AnthropicChatProvider();
    const result = await provider.complete({
      messages: [
        { role: "system", content: "eres util" },
        { role: "user", content: "hola" },
        { role: "tool", content: "dato", toolCallId: "t1" }
      ],
      tools: [{ name: "search", parameters: { type: "object" } }]
    });

    expect(result.text).toBe("respuesta");
    expect(result.provider).toBe("anthropic");
    expect(result.toolCalls).toEqual([{ id: "t1", name: "search", arguments: '{"q":"x"}' }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://anthropic.test/v1/messages");
    expect((init as any).headers["x-api-key"]).toBe("ak");
    expect((init as any).headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse((init as any).body);
    expect(body.system).toBe("eres util");
    expect(body.max_tokens).toBe(1024);
    // El mensaje system no debe ir dentro de messages.
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content[0].type).toBe("tool_result");
    expect(body.tools[0].input_schema).toEqual({ type: "object" });
  });
});
