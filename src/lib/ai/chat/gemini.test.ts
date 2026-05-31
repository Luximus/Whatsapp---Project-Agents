import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  getProviderCredentials: () => ({
    apiKey: "gk",
    baseUrl: "https://gemini.test/v1beta",
    defaultChatModel: "gemini-test"
  })
}));

import { GeminiChatProvider } from "./gemini.js";

describe("GeminiChatProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mapea roles user/model, systemInstruction y functionCall", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "ok" },
                  { functionCall: { name: "getData", args: { id: 7 } } }
                ]
              }
            }
          ]
        })
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new GeminiChatProvider();
    const result = await provider.complete({
      messages: [
        { role: "system", content: "instruccion" },
        { role: "assistant", content: "previo" },
        { role: "user", content: "hola" }
      ]
    });

    expect(result.text).toBe("ok");
    expect(result.toolCalls[0]).toEqual({
      id: "getData",
      name: "getData",
      arguments: '{"id":7}'
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/models/gemini-test:generateContent?key=gk");
    const body = JSON.parse((init as any).body);
    expect(body.systemInstruction.parts[0].text).toBe("instruccion");
    expect(body.contents[0].role).toBe("model");
    expect(body.contents[1].role).toBe("user");
  });
});
