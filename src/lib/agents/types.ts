import type { ChatToolDefinition } from "../ai/types.js";

/**
 * Contrato de una tool de agente. Cada `agents/<proyecto>/scripts/*.js` debe
 * exportar por defecto (o como `tool`) un objeto que cumpla esta interfaz.
 *
 * El runtime NO usa `eval`: carga los scripts por `import()` dinámico desde una
 * carpeta controlada (allowlist por estructura de directorios).
 */
export interface AgentTool {
  /** Nombre único dentro del agente; es el que ve el modelo. */
  name: string;
  description?: string;
  /** JSON Schema de los parámetros que recibe `execute`. */
  parameters: Record<string, unknown>;
  /**
   * Ejecuta la tool. `args` es el JSON ya parseado de los argumentos del
   * modelo. Debe devolver un string (lo que verá el modelo como resultado).
   */
  execute: (args: Record<string, unknown>, context: AgentToolContext) => Promise<string> | string;
}

/** Datos de una cita que la tool de agendamiento envía al equipo comercial. */
export interface ScheduleMeetingInput {
  contactName: string;
  company?: string;
  contactEmail?: string;
  meetingDay?: string;
  meetingDate?: string;
  meetingTime?: string | null;
  service?: string;
  reason?: string;
}

/** Datos para transferir la conversación a un humano (vía correo). */
export interface EscalateToHumanInput {
  contactName?: string;
  company?: string;
  contactEmail?: string;
  topic?: string;
  summary: string;
}

export interface AgentActionResult {
  ok: boolean;
  message?: string;
}

/**
 * Resultado de una acción de la capa de servicios (vínculo/consulta de cuenta).
 * `status` es un código corto que el script traduce a un texto para el modelo.
 */
export interface ServiceActionResult {
  status: string;
  serviceName?: string;
  displayName?: string | null;
  message?: string;
}

export interface AccountInfoResult {
  status: string;
  serviceName?: string;
  data?: unknown;
  message?: string;
}

export interface ListLinksResult {
  accounts: Array<{ serviceId: string; serviceName: string; displayName?: string | null }>;
}

/**
 * Acciones de negocio que la capa de rutas (webhook) inyecta en el contexto
 * para que las tools puedan ejecutarlas SIN importar módulos de `dist` ni meter
 * lógica de negocio en el runtime. Cada acción es opcional: si no está, la tool
 * debe degradar con gracia.
 */
export interface AgentActions {
  /** Agenda una cita: envía el correo de agendamiento al equipo comercial. */
  scheduleMeeting?: (input: ScheduleMeetingInput) => Promise<AgentActionResult>;
  /** Transfiere a un humano: envía la solicitud por correo (NO por WhatsApp). */
  escalateToHuman?: (input: EscalateToHumanInput) => Promise<AgentActionResult>;
  /**
   * Inicia el vínculo del número con la cuenta de un servicio: busca la cuenta
   * por teléfono y, si la encuentra, envía un OTP por WhatsApp (la ruta entrega
   * el código; NUNCA se devuelve al modelo).
   */
  startLink?: (input: { service: string }) => Promise<ServiceActionResult>;
  /** Confirma el OTP y persiste el vínculo. */
  confirmLink?: (input: { service: string; code: string }) => Promise<ServiceActionResult>;
  /** Lista los servicios vinculados al número. */
  listLinks?: () => Promise<ListLinksResult>;
  /** Desvincula una cuenta (y cierra su sesión a servidor si la hay). */
  unlinkAccount?: (input: { service: string }) => Promise<ServiceActionResult>;
  /** Re-autentica el chat con un código 2FA (TOTP) de una cuenta vinculada. */
  authenticate?: (input: { service?: string; code: string }) => Promise<ServiceActionResult>;
  /** Devuelve el perfil/cuenta del servicio vinculado. */
  getAccountInfo?: (input: { service: string }) => Promise<AccountInfoResult>;
  /** Acceso genérico (acotado) a la API del servicio vinculado. */
  callServiceApi?: (input: {
    service: string;
    action: string;
    params?: Record<string, unknown>;
  }) => Promise<AccountInfoResult>;

  // ── Operar un servidor por el asistente IA de LUXIPANEL (Fase 2) ──────────
  /** Lista los accesos SSH del cliente (usuario, host, panel, estado). */
  listServers?: () => Promise<{
    status: string;
    servers?: Array<{
      id: string;
      name: string;
      host: string;
      port?: number;
      linuxUser: string;
      enabled: boolean;
      status: string | null;
      panel?: string;
    }>;
    message?: string;
  }>;
  /** Conecta a un servidor; pregunta con qué usuario SSH si hay varios. */
  connectServer?: (input: { targetId?: string }) => Promise<{
    status: string;
    serverName?: string;
    linuxUser?: string;
    servers?: Array<{ id: string; name: string; linuxUser: string; panel?: string; enabled: boolean }>;
    message?: string;
  }>;
  /** Activa/desactiva (soft-disable) un acceso SSH. */
  setSshEnabled?: (input: { targetId: string; enabled: boolean }) => Promise<{
    status: string;
    name?: string;
    enabled?: boolean;
    message?: string;
  }>;
  /** Envía un mensaje al asistente del servidor conectado y espera el resultado. */
  assistantSend?: (input: { text: string }) => Promise<{
    status: string;
    text?: string;
    message?: string;
  }>;
  /** Reanuda la lectura del último run del asistente (respuestas largas). */
  assistantPoll?: () => Promise<{ status: string; text?: string; message?: string }>;
  /** Cambia el servidor activo de la sesión. */
  switchConnection?: (input: { targetId: string }) => Promise<{
    status: string;
    serverName?: string;
    message?: string;
  }>;
  /** Cierra la sesión a servidor activa. */
  disconnectServer?: () => Promise<{ status: string }>;
}

/** Contexto que el runtime pasa a cada tool en su ejecución. */
export interface AgentToolContext {
  projectKey: string;
  /** Teléfono E164 del interlocutor, si aplica. */
  from?: string | null;
  /** Logger inyectable (Fastify u otro). */
  logger?: Pick<Console, "info" | "warn" | "error">;
  /** Acciones de negocio inyectadas por la capa de rutas (envío de correos, etc.). */
  actions?: AgentActions;
}

/** Un agente cargado: prompt de sistema + sus tools. */
export interface LoadedAgent {
  projectKey: string;
  systemPrompt: string;
  tools: AgentTool[];
  /** Proveedor/modelo override para este agente (opcional). */
  chatProvider?: string;
  chatModel?: string;
}

export function toChatToolDefinition(tool: AgentTool): ChatToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };
}
