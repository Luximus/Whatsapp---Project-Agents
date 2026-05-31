import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryLinkStore } from "./memoryStore.js";

// Connector falso con capacidades 2FA controlables.
const fake = vi.hoisted(() => {
  const connector = {
    id: "lp",
    name: "Cuenta LUXISOFT",
    capabilities: () => ({ profile: true, serverAssistant: false }),
    findAccountByPhone: vi.fn(),
    getProfile: vi.fn(),
    callApi: vi.fn(),
    is2faEnabled: vi.fn(),
    verify2fa: vi.fn()
  };
  return { connector };
});

vi.mock("./registry.js", () => ({
  getConnector: (id: string) => (id === "lp" ? fake.connector : null),
  listConnectors: () => [fake.connector]
}));

import {
  startLink,
  confirmLink,
  confirmPendingLink,
  authenticate,
  getAccountInfo,
  listLinkedAccounts,
  unlinkAccount,
  resetLinkStores,
  getLinkStore
} from "./index.js";

describe("MemoryLinkStore — vínculos y pendientes", () => {
  it("guarda, recupera, lista y revoca vínculos", async () => {
    const store = new MemoryLinkStore();
    await store.saveLink({
      phoneE164: "+573001112233",
      serviceId: "lp",
      accountId: "cust-1",
      displayName: "Jose",
      metadata: {}
    });
    expect(await store.getLink("+573001112233", "lp")).toMatchObject({ accountId: "cust-1" });
    await store.revokeLink("+573001112233", "lp");
    expect(await store.getLink("+573001112233", "lp")).toBeNull();
  });

  it("pending link vía TOTP: crea, recupera, marca verificado", async () => {
    const store = new MemoryLinkStore();
    await store.createPendingLink({
      phoneE164: "+57300",
      serviceId: "lp",
      accountId: "c9",
      via: "totp",
      ttlSeconds: 300
    });
    const p = await store.getActivePendingLink("+57300");
    expect(p).toMatchObject({ serviceId: "lp", accountId: "c9", via: "totp", expired: false });
    await store.markPendingVerified(p!.id);
    expect(await store.getActivePendingLink("+57300")).toBeNull();
  });

  it("sesión 2FA: abre, lee, expira por inactividad (purge)", async () => {
    const store = new MemoryLinkStore();
    await store.openAuthSession({
      phoneE164: "+57300",
      serviceId: "lp",
      accountId: "c",
      method: "totp",
      ttlSeconds: 3600
    });
    expect(await store.getAuthSession("+57300")).not.toBeNull();
    // TTL 0 → vencida → purge la borra
    await store.openAuthSession({
      phoneE164: "+57301",
      serviceId: "lp",
      accountId: "c",
      method: "totp",
      ttlSeconds: 0
    });
    const purged = await store.purgeInactive(3600);
    expect(purged).toContain("+57301");
    expect(await store.getAuthSession("+57301")).toBeNull();
  });
});

describe("vínculo con 2FA obligatorio", () => {
  beforeEach(() => {
    resetLinkStores();
    vi.clearAllMocks();
  });

  it("not_found si no hay cuenta con ese teléfono", async () => {
    fake.connector.findAccountByPhone.mockResolvedValue(null);
    const r = await startLink({}, { phoneE164: "+57300", serviceId: "lp" });
    expect(r.status).toBe("not_found");
  });

  it("needs_2fa si la cuenta no tiene 2FA activo", async () => {
    fake.connector.findAccountByPhone.mockResolvedValue({ accountId: "cust-1" });
    fake.connector.is2faEnabled.mockResolvedValue(false);
    const r = await startLink({}, { phoneE164: "+57300", serviceId: "lp" });
    expect(r.status).toBe("needs_2fa");
  });

  it("need_2fa_code cuando hay cuenta con 2FA; confirma con TOTP y abre sesión", async () => {
    fake.connector.findAccountByPhone.mockResolvedValue({ accountId: "cust-1", displayName: "Jose" });
    fake.connector.is2faEnabled.mockResolvedValue(true);
    const start = await startLink({}, { phoneE164: "+57302", serviceId: "lp" });
    expect(start.status).toBe("need_2fa_code");

    // código TOTP incorrecto
    fake.connector.verify2fa.mockResolvedValueOnce(false);
    const bad = await confirmLink({}, { phoneE164: "+57302", serviceId: "lp", code: "000000" });
    expect(bad.status).toBe("invalid");

    // código TOTP correcto → vinculado + sesión 2FA abierta
    fake.connector.verify2fa.mockResolvedValueOnce(true);
    const ok = await confirmLink({}, { phoneE164: "+57302", serviceId: "lp", code: "123456" });
    expect(ok.status).toBe("linked");
    expect(await getLinkStore({}).getAuthSession("+57302")).not.toBeNull();

    // getAccountInfo ahora pasa (sesión 2FA viva)
    fake.connector.getProfile.mockResolvedValue({ balance: { total: 500 } });
    const info = await getAccountInfo({}, { phoneE164: "+57302", serviceId: "lp" });
    expect(info).toMatchObject({ status: "ok" });

    const links = await listLinkedAccounts({}, "+57302");
    expect(links).toEqual([{ serviceId: "lp", serviceName: "Cuenta LUXISOFT", displayName: "Jose" }]);
  });

  it("confirmPendingLink confirma un TOTP suelto sin saber el servicio", async () => {
    fake.connector.findAccountByPhone.mockResolvedValue({ accountId: "cust-1" });
    fake.connector.is2faEnabled.mockResolvedValue(true);
    await startLink({}, { phoneE164: "+57400", serviceId: "lp" });
    fake.connector.verify2fa.mockResolvedValue(true);
    const r = await confirmPendingLink({}, { phoneE164: "+57400", code: "111111" });
    expect(r).toMatchObject({ status: "linked", serviceName: "Cuenta LUXISOFT" });
  });

  it("confirmPendingLink → none si no hay pendiente", async () => {
    const r = await confirmPendingLink({}, { phoneE164: "+57555", code: "123456" });
    expect(r.status).toBe("none");
  });
});

describe("gating 2FA y re-autenticación", () => {
  beforeEach(() => {
    resetLinkStores();
    vi.clearAllMocks();
  });

  it("getAccountInfo → auth_required si la sesión 2FA no existe/expiró", async () => {
    await getLinkStore({}).saveLink({
      phoneE164: "+57600",
      serviceId: "lp",
      accountId: "cust-1",
      metadata: {}
    });
    const info = await getAccountInfo({}, { phoneE164: "+57600", serviceId: "lp" });
    expect(info.status).toBe("auth_required");
  });

  it("authenticate con TOTP abre la sesión y desbloquea las acciones", async () => {
    await getLinkStore({}).saveLink({
      phoneE164: "+57601",
      serviceId: "lp",
      accountId: "cust-1",
      metadata: {}
    });
    fake.connector.verify2fa.mockResolvedValueOnce(false);
    expect((await authenticate({}, { phoneE164: "+57601", code: "000000" })).status).toBe("invalid");

    fake.connector.verify2fa.mockResolvedValueOnce(true);
    const a = await authenticate({}, { phoneE164: "+57601", code: "123456" });
    expect(a.status).toBe("authenticated");

    fake.connector.getProfile.mockResolvedValue({ ok: 1 });
    const info = await getAccountInfo({}, { phoneE164: "+57601", serviceId: "lp" });
    expect(info.status).toBe("ok");
  });

  it("authenticate → not_linked si el número no tiene vínculo", async () => {
    const a = await authenticate({}, { phoneE164: "+57999", code: "123456" });
    expect(a.status).toBe("not_linked");
  });

  it("unlinkAccount desvincula", async () => {
    await getLinkStore({}).saveLink({
      phoneE164: "+57305",
      serviceId: "lp",
      accountId: "cust-1",
      metadata: {}
    });
    expect((await unlinkAccount({}, { phoneE164: "+57305", serviceId: "lp" })).status).toBe("unlinked");
  });
});
