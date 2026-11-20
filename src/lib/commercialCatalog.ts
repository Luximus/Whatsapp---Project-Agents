import { createClient } from "redis";
import { z } from "zod";
import { env } from "../env.js";

export type CatalogProvider = "luxisoft" | "luxipanel";
export type CatalogArea = "plans" | "engines";
export type CatalogSnapshot = {
  provider: CatalogProvider;
  area: CatalogArea;
  fetchedAt: string;
  expiresAt: number;
  data: Record<string, unknown>;
};
export interface CatalogCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl: number): Promise<void>;
}
const record = z.record(z.string(), z.unknown());
const plans = z.object({
  plans: z.array(record),
  planFamily: z.enum(["legacy", "packages"]).optional(),
  packageProgramActive: z.boolean().optional(),
  previewPackages: z.array(record).optional(),
  tokenPackages: z.array(record).optional(),
  aiUsagePricing: record.optional(),
  freeAllowance: record.nullable().optional(),
  catalogVersion: z.string().optional(),
  rate: z.number().positive().optional(),
  rateSource: z.string().optional(),
  trmDate: z.string().optional()
});
const engines = z.object({ data: z.array(z.object({ key: z.string(), name: z.string(), description: z.string().optional(), enabled: z.boolean().optional(), features: z.array(z.string()).optional() })) });
const snapshotSchema = z.object({ provider: z.enum(["luxisoft", "luxipanel"]), area: z.enum(["plans", "engines"]), fetchedAt: z.string().datetime(), expiresAt: z.number(), data: record });

/** Cache contains only public commercial endpoints, never identity/session data. */
export class CommercialCatalog {
  private pending = new Map<string, Promise<CatalogSnapshot>>();
  constructor(private options: {
    cache: CatalogCache;
    fetchJson: (provider: CatalogProvider, area: CatalogArea) => Promise<unknown>;
    ttlSeconds: number;
    now?: () => number;
  }) {}

  async get(provider: CatalogProvider, area: CatalogArea, refresh = false): Promise<CatalogSnapshot> {
    if (provider === "luxipanel" && area !== "plans") throw new Error("unsupported_catalog_area");
    const key = `whatsapp:commercial:v6:${provider}:${area}`;
    const now = this.options.now ?? Date.now;
    if (!refresh) {
      try {
        const raw = await this.options.cache.get(key);
        if (raw) {
          const cached = snapshotSchema.parse(JSON.parse(raw));
          if (cached.provider === provider && cached.area === area && cached.expiresAt > now()) {
            return { ...cached, data: (area === "plans" ? plans : engines).parse(cached.data) };
          }
        }
      } catch { /* unavailable/malformed cache: read the authority */ }
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const request = (async () => {
      const raw = await this.options.fetchJson(provider, area);
      const data = (area === "plans" ? plans : engines).parse(raw);
      const time = now();
      const dayMs = 86_400_000;
      const bogotaOffset = 5 * 3_600_000;
      const midnight = (Math.floor((time - bogotaOffset) / dayMs) + 1) * dayMs + bogotaOffset;
      const expiresAt = Math.min(time + this.options.ttlSeconds * 1000, midnight);
      const snapshot: CatalogSnapshot = { provider, area, fetchedAt: new Date(time).toISOString(), expiresAt, data };
      try { await this.options.cache.set(key, JSON.stringify(snapshot), Math.max(1, Math.ceil((expiresAt - time) / 1000))); } catch { /* direct fresh response still usable */ }
      return snapshot;
    })();
    this.pending.set(key, request);
    try { return await request; } finally { this.pending.delete(key); }
  }

  async refresh() {
    return Promise.allSettled([this.get("luxisoft", "plans", true), this.get("luxisoft", "engines", true), this.get("luxipanel", "plans", true)]);
  }
}

/** An active package program replaces legacy subscriptions; inactive packages are not for sale. */
export async function fetchLuxisoftPlans(baseUrl: string, fetcher: typeof fetch = fetch): Promise<z.infer<typeof plans>> {
  const base = baseUrl.replace(/\/+$/, "");
  const options = { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) };
  const packageResponse = await fetcher(`${base}/billing/packages`, options);
  if (!packageResponse.ok) throw new Error("catalog_source_unavailable");
  const packageData = z.object({ ok: z.literal(true), data: z.object({
    active: z.boolean(), packages: z.array(record), previewPackages: z.array(record).optional(),
    tokenPackages: z.array(record).optional(), aiUsagePricing: record.optional(), freeAllowance: record.nullable().optional(), version: z.string().optional()
  }) }).parse(await packageResponse.json());
  const publicData = {
    freeAllowance: packageData.data.freeAllowance,
    packageProgramActive: packageData.data.active,
    previewPackages: packageData.data.previewPackages,
    tokenPackages: packageData.data.tokenPackages,
    aiUsagePricing: packageData.data.aiUsagePricing,
    catalogVersion: packageData.data.version
  };
  if (packageData.data.active) return plans.parse({ ...publicData, planFamily: "packages", plans: packageData.data.packages });
  const legacyResponse = await fetcher(`${base}/billing/plans`, options);
  if (!legacyResponse.ok) throw new Error("catalog_source_unavailable");
  return plans.parse({ ...plans.parse(await legacyResponse.json()), ...publicData, planFamily: "legacy" });
}

const client = createClient({ url: env.REDIS_URL || undefined, disableOfflineQueue: true, socket: { connectTimeout: 1500, reconnectStrategy: false } });
client.on("error", () => {}); // never log connection URLs or credentials
let connecting: Promise<void> | undefined;
let retryAfter = 0;
async function redisReady() {
  if (!env.REDIS_URL) throw new Error("catalog_cache_not_configured");
  if (client.isReady) return;
  if (Date.now() < retryAfter) throw new Error("catalog_cache_unavailable");
  connecting ??= client.connect().then(() => {}).catch(() => { retryAfter = Date.now() + 30000; throw new Error("catalog_cache_unavailable"); }).finally(() => { connecting = undefined; });
  await connecting;
}
async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("catalog_cache_timeout")), 1500); })]);
  } finally { if (timer) clearTimeout(timer); }
}
export const commercialCatalog = new CommercialCatalog({
  ttlSeconds: env.COMMERCIAL_CATALOG_TTL_SECONDS,
  cache: {
    async get(key) { await redisReady(); return bounded(client.get(key)); },
    async set(key, value, ttl) { await redisReady(); await bounded(client.set(key, value, { EX: ttl })); }
  },
  async fetchJson(provider, area) {
    if (provider === "luxisoft" && area === "plans") return fetchLuxisoftPlans(env.LUXISOFT_PLATFORM_API_URL);
    const url = provider === "luxipanel"
      ? `${env.lpApiBaseUrl}/public/luxipanel-plans`
      : `${env.LUXISOFT_PLATFORM_API_URL.replace(/\/+$/, "")}/templates`;
    const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("catalog_source_unavailable");
    return response.json();
  }
});

export async function getCommercialCatalog(input: { provider?: CatalogProvider; area?: CatalogArea }) {
  try { return { status: "ok" as const, catalog: await commercialCatalog.get(input.provider ?? "luxisoft", input.area ?? "plans") }; }
  catch { return { status: "unavailable" as const }; }
}
export function startCommercialCatalog(logger: { info: (obj: object, message: string) => void }) {
  // Requests already fetch lazily through the durable cache.
  if (process.env.DEMAND_RUNTIME_ENABLED === "1") return async () => { if (client.isOpen) client.destroy(); };
  const refresh = async () => {
    const results = await commercialCatalog.refresh();
    logger.info({ refreshed: results.filter(r => r.status === "fulfilled").length, failed: results.filter(r => r.status === "rejected").length }, "Commercial catalog refresh");
  };
  void refresh();
  const timer = setInterval(() => { void refresh(); }, env.COMMERCIAL_CATALOG_TTL_SECONDS * 1000);
  timer.unref();
  return async () => { clearInterval(timer); if (client.isOpen) client.destroy(); };
}
