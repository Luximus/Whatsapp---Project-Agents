import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { startDailyReportScheduler, stopDailyReportScheduler } from "./jobs/dailyReport.js";

const app = buildApp();
await app.listen({ port: env.PORT, host: env.HOST });
startDailyReportScheduler(app.log as any);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopDailyReportScheduler();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
