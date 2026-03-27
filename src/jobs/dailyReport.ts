import cron, { type ScheduledTask } from "node-cron";
import { env } from "../config/env.js";
import {
  runScheduledDailyReport,
  setDailyReportLogger
} from "../application/reporting/sendDailyReport.js";

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

let reportTask: ScheduledTask | null = null;
let reportInProgress = false;

export function startDailyReportScheduler(logger?: LoggerLike) {
  if (reportTask) return;

  if (logger) {
    setDailyReportLogger(logger);
  }

  const log: LoggerLike = logger ?? {
    info: (obj, msg) => console.log(msg ?? "", obj ?? ""),
    warn: (obj, msg) => console.warn(msg ?? "", obj ?? ""),
    error: (obj, msg) => console.error(msg ?? "", obj ?? "")
  };

  if (!cron.validate(env.reportCron)) {
    log.error({ reportCron: env.reportCron }, "Invalid REPORT_CRON expression");
    return;
  }

  reportTask = cron.schedule(
    env.reportCron,
    async () => {
      if (reportInProgress) return;
      reportInProgress = true;
      try {
        await runScheduledDailyReport();
      } finally {
        reportInProgress = false;
      }
    },
    { timezone: env.reportTimezone }
  );

  log.info(
    {
      reportCron: env.reportCron,
      reportTimezone: env.reportTimezone,
      reportEmailTo: env.reportEmailTo
    },
    "Daily report scheduler started"
  );
}

export function stopDailyReportScheduler() {
  if (!reportTask) return;
  reportTask.stop();
  reportTask.destroy();
  reportTask = null;
}
