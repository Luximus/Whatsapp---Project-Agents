import { transcribeAudio } from "./ai/index.js";

/**
 * @deprecated Usar `transcribeAudio` / `getDefaultTranscriptionProvider` de
 * `./ai/index.js`. Se conserva como envoltura fina para no romper imports
 * existentes; delega en la capa de IA agnóstica de proveedor.
 */
export async function transcribeAudioWithOpenAI(input: {
  data: Buffer;
  mimeType?: string | null;
  filename?: string | null;
}) {
  return transcribeAudio(input);
}
