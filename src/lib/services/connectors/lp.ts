import { lpClient, monthlyUsage } from "../lpClient.js";
import type { AccountLink, LinkCandidate, ServiceApiRequest, ServiceConnector } from "../types.js";

/**
 * Connector de la cuenta de cliente en LP-LICENSE-SERVER (la autoridad).
 * Es la identidad base: nombre, correo, teléfono, saldo (diamantes/MB) y paneles.
 */
export const lpConnector: ServiceConnector = {
  id: "lp",
  name: "Cuenta LUXISOFT",

  capabilities() {
    return { profile: true, serverAssistant: false };
  },

  async findAccountByPhone(e164: string): Promise<LinkCandidate | null> {
    const res = await lpClient.lookupByPhone(e164);
    if (!res.found || !res.customerId) return null;
    return {
      accountId: res.customerId,
      displayName: res.displayName,
      metadata: { hasPanels: Boolean(res.hasPanels), maskedEmail: res.maskedEmail }
    };
  },

  async getProfile(link: AccountLink): Promise<Record<string, unknown>> {
    const s = await lpClient.accountSummary(link.accountId);
    return {
      name: s.name,
      email: s.email,
      phone: s.phone,
      balance: { free: s.freeBalance, paid: s.paidBalance, total: s.freeBalance + s.paidBalance },
      consumoEsteMes: monthlyUsage(s.usageThisMonth),
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
      case "summary":
      case "profile":
        return this.getProfile(link);
      case "balance": {
        const s = await lpClient.accountSummary(link.accountId);
        return { free: s.freeBalance, paid: s.paidBalance, total: s.freeBalance + s.paidBalance };
      }
      case "panels": {
        const s = await lpClient.accountSummary(link.accountId);
        return s.panels;
      }
      default:
        throw new Error(`accion_no_soportada:${req.action}`);
    }
  },

  async is2faEnabled(accountId: string): Promise<boolean> {
    const s = await lpClient.twoFaStatus(accountId);
    return Boolean(s.enabled);
  },

  async verify2fa(accountId: string, code: string): Promise<boolean> {
    const r = await lpClient.twoFaVerify(accountId, code);
    return Boolean(r.verified);
  }
};
