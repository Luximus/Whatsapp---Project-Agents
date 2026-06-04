import { lpClient, monthlyUsage } from "../lpClient.js";
import type { AccountLink, LinkCandidate, ServiceApiRequest, ServiceConnector } from "../types.js";

/**
 * Connector de LUXIPANEL. La identidad se delega en LP (el panel pertenece a un
 * cliente LP), así que el vínculo usa la misma búsqueda por teléfono. En Fase 1
 * expone el perfil (paneles/servidores del cliente). La operación del módulo
 * asistente en background (chatear/crear/editar en el servidor) es Fase 2 →
 * `serverAssistant` se habilitará entonces.
 */
export const luxipanelConnector: ServiceConnector = {
  id: "luxipanel",
  name: "LUXIPANEL",

  capabilities() {
    return { profile: true, serverAssistant: true };
  },

  async findAccountByPhone(e164: string): Promise<LinkCandidate | null> {
    const res = await lpClient.lookupByPhone(e164);
    if (!res.found || !res.customerId) return null;
    if (!res.hasPanels) {
      // El cliente existe pero no tiene paneles → no hay nada que operar en LUXIPANEL.
      return null;
    }
    return {
      accountId: res.customerId,
      displayName: res.displayName,
      whatsappVerified: Boolean(res.whatsappVerified),
      metadata: { maskedEmail: res.maskedEmail }
    };
  },

  async getProfile(link: AccountLink): Promise<Record<string, unknown>> {
    const s = await lpClient.accountSummary(link.accountId);
    return {
      owner: s.name,
      email: s.email,
      // Consumo de datos del mes en curso (lo relevante para el usuario).
      consumoEsteMes: monthlyUsage(s.usageThisMonth),
      panelsCount: s.panels.length,
      panels: s.panels.map((p) => ({
        name: p.name,
        status: p.status,
        subdomain: p.subdomain,
        customDomain: p.customDomain,
        serverIp: p.serverIp,
        serverSlots: p.serverSlots
      }))
    };
  },

  async callApi(link: AccountLink, req: ServiceApiRequest): Promise<unknown> {
    switch (req.action) {
      case "panels":
      case "servers": {
        const s = await lpClient.accountSummary(link.accountId);
        return s.panels;
      }
      case "profile":
        return this.getProfile(link);
      default:
        throw new Error(`accion_no_soportada:${req.action}`);
    }
  },

  // LUXIPANEL comparte la identidad/2FA de LP (el panel pertenece a un cliente LP).
  async is2faEnabled(accountId: string): Promise<boolean> {
    const s = await lpClient.twoFaStatus(accountId);
    return Boolean(s.enabled);
  },

  async verify2fa(accountId: string, code: string): Promise<boolean> {
    const r = await lpClient.twoFaVerify(accountId, code);
    return Boolean(r.verified);
  }
};
