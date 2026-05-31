import { env } from "../../../env.js";
import { getProviderCredentials } from "../config.js";
import {
  AiProviderError,
  type AiProviderName,
  type SpeechProvider,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult
} from "../types.js";

// Mapa formato OpenAI → (MIME, extensión). "opus" entrega audio/ogg, el único
// contenedor que WhatsApp trata como NOTA DE VOZ real (`voice: true`).
const FORMAT_MAP: Record<string, { mimeType: string; extension: string }> = {
  opus: { mimeType: "audio/ogg", extension: "ogg" },
  mp3: { mimeType: "audio/mpeg", extension: "mp3" },
  aac: { mimeType: "audio/aac", extension: "aac" },
  flac: { mimeType: "audio/flac", extension: "flac" },
  wav: { mimeType: "audio/wav", extension: "wav" },
  pcm: { mimeType: "audio/pcm", extension: "pcm" }
};

/**
 * Síntesis de voz (TTS) vía endpoint compatible con OpenAI
 * (`POST {baseUrl}/audio/speech`). Sirve para OpenAI y pasarelas compatibles.
 */
export class OpenAiCompatibleSpeechProvider implements SpeechProvider {
  readonly name: AiProviderName;

  constructor(name: AiProviderName = "openai") {
    this.name = name;
  }

  async synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
    const creds = getProviderCredentials(this.name);
    if (!creds.apiKey) {
      throw new AiProviderError(this.name, `${this.name}_not_configured`);
    }

    const text = String(request.text ?? "").trim();
    if (!text) {
      throw new AiProviderError(this.name, `${this.name}_speech_text_required`);
    }

    const format = (request.format || env.openaiSpeechFormat || "opus").toLowerCase();
    const meta = FORMAT_MAP[format] ?? FORMAT_MAP.opus;
    const model = request.model || env.openaiSpeechModel;
    const voice = request.voice || env.openaiSpeechVoice;

    const response = await fetch(`${creds.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: format
      })
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new AiProviderError(this.name, `${this.name}_speech_failed`, {
        statusCode: response.status,
        details
      });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new AiProviderError(this.name, `${this.name}_speech_empty`);
    }

    return { data: buffer, mimeType: meta.mimeType, extension: meta.extension };
  }
}
