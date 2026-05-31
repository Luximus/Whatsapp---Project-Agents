import { lpConnector } from "./connectors/lp.js";
import { luxipanelConnector } from "./connectors/luxipanel.js";
import { luxichatConnector } from "./connectors/luxichat.js";
import type { ServiceConnector } from "./types.js";

/**
 * Registro de servicios enchufables. Agregar un servicio = importar su connector
 * y añadirlo aquí. El resto del sistema (tools, runtime) solo habla por la
 * interfaz `ServiceConnector`.
 */
const CONNECTORS: ServiceConnector[] = [lpConnector, luxipanelConnector, luxichatConnector];

const byId = new Map<string, ServiceConnector>(CONNECTORS.map((c) => [c.id, c]));

// Alias comunes → id de connector, para tolerar lo que escriba el usuario/modelo.
const ALIASES: Record<string, string> = {
  luxisoft: "lp",
  cuenta: "lp",
  licencias: "lp",
  panel: "luxipanel",
  paneles: "luxipanel",
  chat: "luxichat"
};

/** Resuelve un connector por id o alias (case-insensitive). */
export function getConnector(serviceId: string): ServiceConnector | null {
  const raw = String(serviceId ?? "")
    .trim()
    .toLowerCase();
  const id = byId.has(raw) ? raw : (ALIASES[raw] ?? raw);
  return byId.get(id) ?? null;
}

/** Lista todos los connectors registrados. */
export function listConnectors(): ServiceConnector[] {
  return [...CONNECTORS];
}
