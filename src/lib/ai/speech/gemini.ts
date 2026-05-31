import { env } from "../../../env.js";
import { getProviderCredentials } from "../config.js";
import {
  AiProviderError,
  type SpeechProvider,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult
} from "../types.js";

/**
 * Síntesis de voz con la API generateContent de Gemini (modelos `*-tts`).
 * Gemini devuelve PCM crudo (audio/L16) en base64; lo envolvemos en un
 * contenedor WAV para que sea reproducible. WhatsApp no lo trata como nota de
 * voz (solo OGG/Opus lo es), pero sí lo envía como audio normal reproducible.
 */
export class GeminiSpeechProvider implements SpeechProvider {
  readonly name = "gemini" as const;

  async synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
    const creds = getProviderCredentials("gemini");
    if (!creds.apiKey) {
      throw new AiProviderError("gemini", "gemini_not_configured");
    }

    const text = String(request.text ?? "").trim();
    if (!text) {
      throw new AiProviderError("gemini", "gemini_speech_text_required");
    }

    const model = request.model || env.geminiSpeechModel;
    const voice = request.voice || env.geminiSpeechVoice;

    const url = `${creds.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(creds.apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
          }
        }
      })
    });

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new AiProviderError("gemini", "gemini_speech_failed", {
        statusCode: response.status,
        details: rawText
      });
    }

    let parsed: any = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new AiProviderError("gemini", "gemini_speech_invalid_json", { details: rawText });
    }

    const part = parsed?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data);
    const base64 = String(part?.inlineData?.data ?? "");
    if (!base64) {
      throw new AiProviderError("gemini", "gemini_speech_empty", { details: parsed });
    }

    const pcm = Buffer.from(base64, "base64");
    // mimeType típico: "audio/L16;rate=24000". Extraemos la tasa de muestreo.
    const partMime = String(part?.inlineData?.mimeType ?? "");
    const rateMatch = partMime.match(/rate=(\d+)/i);
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    const wav = pcmToWav(pcm, { sampleRate, channels: 1, bitsPerSample: 16 });

    return { data: wav, mimeType: "audio/wav", extension: "wav" };
  }
}

/** Envuelve PCM lineal (16-bit) en un contenedor WAV (RIFF) válido. */
function pcmToWav(
  pcm: Buffer,
  opts: { sampleRate: number; channels: number; bitsPerSample: number }
): Buffer {
  const { sampleRate, channels, bitsPerSample } = opts;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // tamaño del subchunk fmt
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}
