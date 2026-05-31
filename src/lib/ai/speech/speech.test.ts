import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../config.js", () => ({
  getProviderCredentials: (provider: string) => ({
    apiKey: "ak",
    baseUrl: `https://${provider}.test/v1`,
    defaultChatModel: "m"
  })
}));

vi.mock("../../../env.js", () => ({
  env: {
    openaiSpeechModel: "gpt-4o-mini-tts",
    openaiSpeechVoice: "alloy",
    openaiSpeechFormat: "opus",
    geminiSpeechModel: "gemini-tts",
    geminiSpeechVoice: "Kore",
    minimaxSpeechModel: "speech-02-hd",
    minimaxSpeechVoice: "v1",
    minimaxGroupId: "grp"
  }
}));

import { OpenAiCompatibleSpeechProvider } from "./openaiCompatible.js";
import { GeminiSpeechProvider } from "./gemini.js";
import { MiniMaxSpeechProvider } from "./minimax.js";

describe("OpenAiCompatibleSpeechProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pide /audio/speech con opus y devuelve audio/ogg", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiCompatibleSpeechProvider("openai");
    const result = await provider.synthesize({ text: "hola mundo" });

    expect(result.mimeType).toBe("audio/ogg");
    expect(result.extension).toBe("ogg");
    expect(result.data).toEqual(Buffer.from([1, 2, 3]));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openai.test/v1/audio/speech");
    const body = JSON.parse((init as any).body);
    expect(body.input).toBe("hola mundo");
    expect(body.response_format).toBe("opus");
    expect(body.voice).toBe("alloy");
  });

  it("mapea mp3 a audio/mpeg", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([9]).buffer
      })
    );
    const provider = new OpenAiCompatibleSpeechProvider("openai");
    const result = await provider.synthesize({ text: "x", format: "mp3" });
    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.extension).toBe("mp3");
  });

  it("propaga error del proveedor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" })
    );
    const provider = new OpenAiCompatibleSpeechProvider("openai");
    await expect(provider.synthesize({ text: "x" })).rejects.toThrow("openai_speech_failed");
  });
});

describe("GeminiSpeechProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envuelve el PCM devuelto en un WAV válido", async () => {
    const pcm = Buffer.from([0, 0, 1, 0, 2, 0]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/L16;rate=24000",
                        data: pcm.toString("base64")
                      }
                    }
                  ]
                }
              }
            ]
          })
      })
    );

    const provider = new GeminiSpeechProvider();
    const result = await provider.synthesize({ text: "hola" });

    expect(result.mimeType).toBe("audio/wav");
    expect(result.data.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(result.data.subarray(8, 12).toString("ascii")).toBe("WAVE");
    // header 44 bytes + payload PCM
    expect(result.data.length).toBe(44 + pcm.length);
    // sample rate parseado del mimeType
    expect(result.data.readUInt32LE(24)).toBe(24000);
  });
});

describe("MiniMaxSpeechProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("decodifica el audio HEX a mp3 y manda GroupId", async () => {
    const mp3 = Buffer.from([0xff, 0xfb, 0x00]);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: { audio: mp3.toString("hex"), status: 2 },
          base_resp: { status_code: 0, status_msg: "ok" }
        })
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new MiniMaxSpeechProvider();
    const result = await provider.synthesize({ text: "hola" });

    expect(result.mimeType).toBe("audio/mpeg");
    expect(result.data).toEqual(mp3);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://minimax.test/v1/t2a_v2?GroupId=grp");
  });

  it("falla si base_resp.status_code != 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ base_resp: { status_code: 1004, status_msg: "auth" } })
      })
    );
    const provider = new MiniMaxSpeechProvider();
    await expect(provider.synthesize({ text: "x" })).rejects.toThrow("minimax_speech_failed");
  });
});
