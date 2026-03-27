import { env } from "../../config/env.js";
import { HttpError } from "../../errors/HttpError.js";

function resolveOpenAIBaseUrl() {
  const base = env.openaiBaseUrl.trim() || "https://api.openai.com/v1";
  return base.replace(/\/+$/, "");
}

export async function transcribeAudioWithOpenAI(input: {
  data: Buffer;
  mimeType?: string | null;
  filename?: string | null;
}): Promise<string> {
  if (!env.openaiApiKey) throw new Error("openai_not_configured");

  const mimeType = String(input.mimeType ?? "").trim() || "audio/mpeg";
  const filename = String(input.filename ?? "").trim() || "voice-note.mp3";
  const models = Array.from(new Set([env.openaiAudioTranscribeModel, "whisper-1"].filter(Boolean)));

  let lastError: unknown = null;
  for (const model of models) {
    const form = new FormData();
    form.set("model", model);
    form.set("file", new Blob([input.data], { type: mimeType }), filename);

    const response = await fetch(`${resolveOpenAIBaseUrl()}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.openaiApiKey}` },
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
      lastError = { model, error: "openai_transcription_empty" };
    } catch {
      lastError = { model, error: "openai_transcription_invalid_json", raw };
    }
  }

  throw new HttpError(500, "openai_transcription_failed", lastError);
}
