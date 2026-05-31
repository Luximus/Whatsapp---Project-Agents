import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryLinkStore } from "./memoryStore.js";

// Connector luxipanel con serverAssistant habilitado.
const fake = vi.hoisted(() => ({
  connector: {
    id: "luxipanel",
    name: "LUXIPANEL",
    capabilities: () => ({ profile: true, serverAssistant: true }),
    findAccountByPhone: vi.fn(),
    getProfile: vi.fn(),
    callApi: vi.fn()
  },
  lp: {
    listServers: vi.fn(),
    issueSessionForLinked: vi.fn(),
    setSshEnabled: vi.fn()
  },
  panel: {
    exchangeSsoToken: vi.fn(),
    enqueueMessage: vi.fn(),
    isRunActive: vi.fn(),
    readResult: vi.fn()
  }
}));

vi.mock("./registry.js", () => ({
  getConnector: (id: string) => (id === "luxipanel" ? fake.connector : null),
  listConnectors: () => [fake.connector]
}));
vi.mock("./lpClient.js", () => ({ lpClient: fake.lp }));
vi.mock("./luxipanelClient.js", () => ({
  exchangeSsoToken: fake.panel.exchangeSsoToken,
  enqueueMessage: fake.panel.enqueueMessage,
  isRunActive: fake.panel.isRunActive,
  readResult: fake.panel.readResult
}));

import {
  connectServer,
  assistantSend,
  listServers,
  setSshEnabled,
  disconnectServer
} from "./serverAssistant.js";
import { resetLinkStores, getLinkStore } from "./factory.js";

describe("MemoryLinkStore — sesiones a servidor", () => {
  it("guarda, recupera y termina", async () => {
    const store = new MemoryLinkStore();
    await store.saveServerSession({
      phoneE164: "+57300",
      serviceId: "luxipanel",
      accountId: "c1",
      targetId: "t1",
      conversationId: "wa-57300-t1",
      status: "active"
    });
    expect(await store.getServerSession("+57300", "luxipanel")).toMatchObject({ targetId: "t1" });
    await store.endServerSession("+57300", "luxipanel");
    expect(await store.getServerSession("+57300", "luxipanel")).toBeNull();
  });
});

describe("serverAssistant", () => {
  beforeEach(() => {
    resetLinkStores();
    vi.clearAllMocks();
  });

  async function link(phone: string) {
    const store = getLinkStore({});
    await store.saveLink({
      phoneE164: phone,
      serviceId: "luxipanel",
      accountId: "cust-1",
      metadata: {}
    });
    // Las acciones de servidor exigen sesión 2FA viva.
    await store.openAuthSession({
      phoneE164: phone,
      serviceId: "luxipanel",
      accountId: "cust-1",
      method: "totp",
      ttlSeconds: 3600
    });
  }

  it("connectServer pide elegir si hay varios servidores", async () => {
    await link("+57300");
    fake.lp.listServers.mockResolvedValue([
      { id: "t1", name: "web", host: "***.io", linuxUser: "u", status: null },
      { id: "t2", name: "db", host: "***.io", linuxUser: "u", status: null }
    ]);
    const r = await connectServer({}, { phoneE164: "+57300" });
    expect(r.status).toBe("choose");
  });

  it("connectServer conecta a un único servidor y abre sesión", async () => {
    await link("+57301");
    fake.lp.listServers.mockResolvedValue([
      { id: "t1", name: "web", host: "***.io", linuxUser: "u", status: null }
    ]);
    fake.lp.issueSessionForLinked.mockResolvedValue({
      sessionId: "s1",
      sessionToken: "jwt",
      redirectUrl: "https://x/sso/callback?session=jwt",
      expiresAt: "2030-01-01T00:00:00Z"
    });
    fake.panel.exchangeSsoToken.mockResolvedValue({ bearer: "B", kind: "admin", modules: ["assistant"] });
    const r = await connectServer({}, { phoneE164: "+57301" });
    expect(r).toMatchObject({ status: "connected", serverName: "web" });
    expect(await getLinkStore({}).getServerSession("+57301", "luxipanel")).toMatchObject({
      targetId: "t1"
    });
  });

  it("connectServer → not_linked si el número no tiene vínculo luxipanel", async () => {
    const r = await connectServer({}, { phoneE164: "+57999" });
    expect(r.status).toBe("not_linked");
  });

  it("connectServer → auth_required si hay vínculo pero no sesión 2FA", async () => {
    await getLinkStore({}).saveLink({
      phoneE164: "+57888",
      serviceId: "luxipanel",
      accountId: "cust-1",
      metadata: {}
    });
    const r = await connectServer({}, { phoneE164: "+57888" });
    expect(r.status).toBe("auth_required");
  });

  it("assistantSend autenticado pero sin servidor → no_session", async () => {
    await getLinkStore({}).openAuthSession({
      phoneE164: "+57777",
      serviceId: "luxipanel",
      accountId: "cust-1",
      method: "totp",
      ttlSeconds: 3600
    });
    const r = await assistantSend({}, { phoneE164: "+57777", text: "hola" });
    expect(r.status).toBe("no_session");
  });

  it("assistantSend sin sesión 2FA → auth_required", async () => {
    const r = await assistantSend({}, { phoneE164: "+57778", text: "hola" });
    expect(r.status).toBe("auth_required");
  });

  it("assistantSend devuelve la respuesta del asistente", async () => {
    await link("+57302");
    fake.lp.listServers.mockResolvedValue([
      { id: "t1", name: "web", host: "***.io", linuxUser: "u", status: null }
    ]);
    fake.lp.issueSessionForLinked.mockResolvedValue({
      sessionId: "s1",
      sessionToken: "jwt",
      redirectUrl: "x",
      expiresAt: "2030-01-01T00:00:00Z"
    });
    fake.panel.exchangeSsoToken.mockResolvedValue({ bearer: "B", kind: "admin", modules: ["assistant"] });
    await connectServer({}, { phoneE164: "+57302" });

    fake.panel.enqueueMessage.mockResolvedValue({ id: "q1", pendingCount: 1 });
    fake.panel.readResult.mockResolvedValue({ text: "Node v20", done: true });
    const r = await assistantSend({}, { phoneE164: "+57302", text: "qué versión de node?" });
    expect(r).toMatchObject({ status: "answer", text: "Node v20" });
    expect(fake.panel.enqueueMessage).toHaveBeenCalledWith(
      "B",
      expect.objectContaining({ conversationId: "wa-57302-t1", userText: "qué versión de node?" })
    );
  });

  it("disconnectServer cierra la sesión activa", async () => {
    await link("+57304");
    fake.lp.listServers.mockResolvedValue([
      { id: "t1", name: "web", host: "***.io", linuxUser: "u", status: null }
    ]);
    fake.lp.issueSessionForLinked.mockResolvedValue({
      sessionId: "s1",
      sessionToken: "jwt",
      redirectUrl: "x",
      expiresAt: "2030-01-01T00:00:00Z"
    });
    fake.panel.exchangeSsoToken.mockResolvedValue({ bearer: "B", kind: "admin", modules: ["assistant"] });
    await connectServer({}, { phoneE164: "+57304" });
    expect(await getLinkStore({}).getServerSession("+57304", "luxipanel")).not.toBeNull();

    const d = await disconnectServer({}, { phoneE164: "+57304" });
    expect(d.status).toBe("disconnected");
    expect(await getLinkStore({}).getServerSession("+57304", "luxipanel")).toBeNull();
  });

  it("disconnectServer sin sesión → no_session", async () => {
    const d = await disconnectServer({}, { phoneE164: "+57666" });
    expect(d.status).toBe("no_session");
  });

  it("listServers mapea los usuarios SSH (con usuario, panel y estado)", async () => {
    await link("+57303");
    fake.lp.listServers.mockResolvedValue([
      {
        id: "t1",
        name: "web",
        host: "1.2.3.4",
        port: 22,
        linuxUser: "jmarin",
        enabled: true,
        status: "connected",
        panel: { id: "p1", name: "backend" }
      }
    ]);
    const r = await listServers({}, { phoneE164: "+57303" });
    expect(r.status).toBe("ok");
    expect(r.servers).toEqual([
      {
        id: "t1",
        name: "web",
        host: "1.2.3.4",
        port: 22,
        linuxUser: "jmarin",
        enabled: true,
        status: "connected",
        panel: "backend"
      }
    ]);
  });

  it("setSshEnabled desactiva un usuario SSH", async () => {
    await link("+57310");
    fake.lp.setSshEnabled.mockResolvedValue({ id: "t1", name: "web", enabled: false });
    const r = await setSshEnabled({}, { phoneE164: "+57310", targetId: "t1", enabled: false });
    expect(r).toMatchObject({ status: "ok", enabled: false });
  });

  it("connectServer omite accesos desactivados al elegir", async () => {
    await link("+57311");
    fake.lp.listServers.mockResolvedValue([
      { id: "t1", name: "web", host: "h", linuxUser: "a", enabled: true, status: null },
      { id: "t2", name: "db", host: "h", linuxUser: "b", enabled: false, status: null }
    ]);
    // dos registrados pero solo uno activo → conecta directo al activo
    fake.lp.issueSessionForLinked.mockResolvedValue({
      sessionId: "s1",
      sessionToken: "jwt",
      redirectUrl: "x",
      expiresAt: "2030-01-01T00:00:00Z"
    });
    fake.panel.exchangeSsoToken.mockResolvedValue({ bearer: "B", kind: "admin", modules: [] });
    const r = await connectServer({}, { phoneE164: "+57311" });
    expect(r).toMatchObject({ status: "connected", linuxUser: "a" });
  });
});
