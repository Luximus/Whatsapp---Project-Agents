/**
 * Punto de entrada de la capa de IA agnóstica de proveedor.
 *
 * El negocio importa SOLO desde aquí:
 *   import { transcribeAudio, getDefaultChatProvider } from "../lib/ai/index.js";
 */
export * from "./types.js";
export { createChatProvider, getDefaultChatProvider } from "./chat/index.js";
export {
  createTranscriptionProvider,
  getDefaultTranscriptionProvider,
  transcribeAudio
} from "./transcription/index.js";
