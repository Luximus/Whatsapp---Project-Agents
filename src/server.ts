import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { startDailyReportScheduler, stopDailyReportScheduler } from "./jobs/dailyReport.js";
import { loadTodayMetricsFromDb, flushTodayMetricsToDb } from "./domain/reporting/tracker.js";

const app = buildApp();
await app.listen({ port: env.PORT, host: env.HOST });

// Load today's persisted metrics so they survive server restarts
await loadTodayMetricsFromDb();

startDailyReportScheduler(app.log as any);

// Flush metrics to DB every 5 minutes
const metricsFlushInterval = setInterval(flushTodayMetricsToDb, 5 * 60 * 1000);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(metricsFlushInterval);
  stopDailyReportScheduler();
  await flushTodayMetricsToDb();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
