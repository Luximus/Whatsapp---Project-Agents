import { env } from "../../../env.js";
import { getProviderCredentials } from "../config.js";
import {
  AiProviderError,
  type SpeechProvider,
  type SpeechSynthesisRequest,
  type SpeechSynthesisResult
} from "../types.js";

/**
 * Síntesis de voz con la API T2A v2 de MiniMax (`POST {baseUrl}/t2a_v2`).
 * Requiere `GroupId` como query param. Devuelve el audio como cadena HEX
 * (mp3 por defecto). WhatsApp lo envía como audio normal reproducible (no nota
 * de voz: para eso se necesita OGG/Opus).
 */
export class MiniMaxSpeechProvider implements SpeechProvider {
  readonly name = "minimax" as const;

  async synthesize(request: SpeechSynthesisRequest): Promise<SpeechSynthesisResult> {
    const creds = getProviderCredentials("minimax");
    if (!creds.apiKey) {
      throw new AiProviderError("minimax", "minimax_not_configured");
    }
    if (!env.minimaxGroupId) {
      throw new AiProviderError("minimax", "minimax_group_id_required");
    }

    const text = String(request.text ?? "").trim();
    if (!text) {
      throw new AiProviderError("minimax", "minimax_speech_text_required");
    }

    const model = request.model || env.minimaxSpeechModel;
    const voice = request.voice || env.minimaxSpeechVoice;

    const url = `${creds.baseUrl}/t2a_v2?GroupId=${encodeURIComponent(env.minimaxGroupId)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        text,
        stream: false,
        voice_setting: { voice_id: voice, speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 }
      })
    });

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new AiProviderError("minimax", "minimax_speech_failed", {
        statusCode: response.status,
        details: rawText
      });
    }

    let parsed: any = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new AiProviderError("minimax", "minimax_speech_invalid_json", { details: rawText });
    }

    const statusCode = Number(parsed?.base_resp?.status_code ?? 0);
    if (statusCode !== 0) {
      throw new AiProviderError("minimax", "minimax_speech_failed", { details: parsed?.base_resp });
    }

    const hex = String(parsed?.data?.audio ?? "");
    if (!hex) {
      throw new AiProviderError("minimax", "minimax_speech_empty", { details: parsed });
    }

    return { data: Buffer.from(hex, "hex"), mimeType: "audio/mpeg", extension: "mp3" };
  }
}
