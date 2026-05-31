import { env } from "./env.js";
import { buildApp } from "./app.js";
import { startDailyReportScheduler, stopDailyReportScheduler } from "./lib/reporting.js";
import { purgeInactiveSessions } from "./lib/services/index.js";

const app = buildApp();
await app.listen({ port: env.PORT, host: env.HOST });
startDailyReportScheduler(app.log as any);

// Purga de sesiones 2FA inactivas (>TTL): borra chat + sesiones a servidor y
// fuerza re-autenticación. Corre cada 5 min (solo si la capa de servicios está
// activa). El TTL real lo decide cada sesión (sliding) — esto solo barre.
let purgeTimer: NodeJS.Timeout | null = null;
if (env.whatsappServicesEnabled) {
  purgeTimer = setInterval(() => {
    void purgeInactiveSessions(app)
      .then((phones) => {
        if (phones.length) app.log.info({ count: phones.length }, "purged inactive 2FA sessions");
      })
      .catch(() => {});
  }, 5 * 60 * 1000);
  if (typeof purgeTimer.unref === "function") purgeTimer.unref();
}

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (purgeTimer) clearInterval(purgeTimer);
  stopDailyReportScheduler();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
