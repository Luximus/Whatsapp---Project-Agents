import { env } from "../../../env.js";
import { getProviderCredentials } from "../config.js";
import {
  AiProviderError,
  type AiProviderName,
  type TranscriptionProvider,
  type TranscriptionRequest
} from "../types.js";

/**
 * Transcripción de audio vía endpoint compatible con OpenAI
 * (`POST {baseUrl}/audio/transcriptions`). Sirve para OpenAI y cualquier
 * pasarela compatible con Whisper. Intenta el modelo configurado y, si falla,
 * cae a `whisper-1`.
 */
export class OpenAiCompatibleTranscriptionProvider implements TranscriptionProvider {
  readonly name: AiProviderName;

  constructor(name: AiProviderName = "openai") {
    this.name = name;
  }

  async transcribe(request: TranscriptionRequest): Promise<string> {
    const creds = getProviderCredentials(this.name);
    if (!creds.apiKey) {
      throw new AiProviderError(this.name, `${this.name}_not_configured`);
    }

    const mimeType = String(request.mimeType ?? "").trim() || "audio/mpeg";
    const filename = String(request.filename ?? "").trim() || "voice-note.mp3";
    const requestedModel = request.model || env.openaiAudioTranscribeModel;
    const models = Array.from(new Set([requestedModel, "whisper-1"].filter(Boolean)));

    let lastError: unknown = null;
    for (const model of models) {
      const form = new FormData();
      form.set("model", model);
      form.set("file", new Blob([new Uint8Array(request.data)], { type: mimeType }), filename);

      const response = await fetch(`${creds.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${creds.apiKey}` },
        body: form
      });

      const raw = await response.text().catch(() => "");
      if (!response.ok) {
        lastError = { model, statusCode: response.status, details: raw };
        continue;
      }

      try {
        const parsed = raw ? JSON.parse(raw) : {};
        const text = String(parsed?.text ?? "").trim();
        if (text) return text;
        lastError = { model, error: "transcription_empty" };
      } catch {
        lastError = { model, error: "transcription_invalid_json", raw };
      }
    }

    throw new AiProviderError(this.name, `${this.name}_transcription_failed`, {
      details: lastError
    });
  }
}
