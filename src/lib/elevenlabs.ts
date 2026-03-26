import { env } from "../env.js";

export type ElevenLabsAudio = {
  data: Buffer;
  mimeType: string;
  filename: string;
};

function resolveElevenLabsBaseUrl() {
  const base = env.elevenlabsBaseUrl.trim() || "https://api.elevenlabs.io";
  return base.replace(/\/+$/, "");
}

function inferAudioMetaFromFormat(outputFormat: string) {
  const normalized = outputFormat.toLowerCase();
  if (normalized.startsWith("opus_")) {
    return { mimeType: "audio/ogg", extension: "ogg" };
  }
  if (normalized.startsWith("wav_")) {
    return { mimeType: "audio/wav", extension: "wav" };
  }
  if (normalized.startsWith("mp3_")) {
    return { mimeType: "audio/mpeg", extension: "mp3" };
  }
  if (normalized.startsWith("pcm_")) {
    return { mimeType: "audio/wav", extension: "wav" };
  }
  if (normalized.startsWith("ulaw_")) {
    return { mimeType: "audio/basic", extension: "ulaw" };
  }
  if (normalized.startsWith("alaw_")) {
    return { mimeType: "audio/basic", extension: "alaw" };
  }
  return { mimeType: "audio/mpeg", extension: "mp3" };
}

export function isElevenLabsConfigured() {
  return Boolean(env.elevenlabsApiKey && env.elevenlabsVoiceId);
}

export async function synthesizeSpeechWithElevenLabs(text: string): Promise<ElevenLabsAudio> {
  const prompt = String(text ?? "").trim();
  if (!prompt) {
    throw new Error("elevenlabs_text_required");
  }
  if (!isElevenLabsConfigured()) {
    throw new Error("elevenlabs_not_configured");
  }

  const url = new URL(
    `${resolveElevenLabsBaseUrl()}/v1/text-to-speech/${encodeURIComponent(env.elevenlabsVoiceId)}`
  );
  url.searchParams.set("output_format", env.elevenlabsOutputFormat);

  const audioMeta = inferAudioMetaFromFormat(env.elevenlabsOutputFormat);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": env.elevenlabsApiKey,
      accept: audioMeta.mimeType,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      text: prompt.slice(0, 4000),
      model_id: env.elevenlabsModelId
    })
  });

  const raw = await response.arrayBuffer().catch(() => new ArrayBuffer(0));
  if (!response.ok) {
    const details = Buffer.from(raw).toString("utf8");
    throw Object.assign(new Error("elevenlabs_tts_failed"), {
      statusCode: response.status,
      details
    });
  }

  const data = Buffer.from(raw);
  if (!data.length) {
    throw new Error("elevenlabs_tts_empty_audio");
  }

  return {
    data,
    mimeType: audioMeta.mimeType,
    filename: `reply.${audioMeta.extension}`
  };
}
