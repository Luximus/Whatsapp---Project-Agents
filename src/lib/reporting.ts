import cron, { type ScheduledTask } from "node-cron";
import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { createElement } from "react";
import { env } from "../env.js";
import { WhatsappDailyReportEmail } from "../emails/templates/WhatsappDailyReportEmail.js";
import type { LuxisoftEmailSection } from "../emails/templates/LuxisoftEmailTemplate.js";
import { sendWhatsappText } from "./whatsapp.js";

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

type ModelUsage = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};

type MeetingRecord = {
  projectKey: string;
  userPhone: string;
  contactName: string;
  contactEmail: string;
  company: string;
  meetingDate: string;
  meetingDay: string;
  meetingTime: string | null;
  reason: string;
  notifiedHuman: boolean;
};

type DailyMetrics = {
  dateKey: string;
  uniqueContacts: Set<string>;
  incomingTotal: number;
  incomingText: number;
  incomingAudio: number;
  otpMessages: number;
  agentReplies: number;
  outboundText: number;
  outboundAudio: number;
  meetingsScheduled: number;
  meetingsNotifiedHuman: number;
  openaiFailures: number;
  errors: number;
  openaiByModel: Record<string, ModelUsage>;
};

type OpenAIUsageInput = {
  model: string;
  usage: Record<string, any> | null | undefined;
};

const metricsByDate = new Map<string, DailyMetrics>();
const meetingsByDate = new Map<string, MeetingRecord[]>();
let reportTask: ScheduledTask | null = null;
let reportInProgress = false;
let loggerRef: LoggerLike = {
  info: (obj, msg) => console.log(msg ?? "", obj ?? ""),
  warn: (obj, msg) => console.warn(msg ?? "", obj ?? ""),
  error: (obj, msg) => console.error(msg ?? "", obj ?? "")
};

function zonedDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: env.reportTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const byType = new Map(parts.map((item) => [item.type, item.value]));
  return {
    year: byType.get("year") ?? "0000",
    month: byType.get("month") ?? "00",
    day: byType.get("day") ?? "00"
  };
}

function currentDateKey() {
  const parts = zonedDateParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateLabelForReport(dateKey: string) {
  return dateKey.replace(/-/g, "/");
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function ensureDailyMetrics(dateKey = currentDateKey()) {
  const existing = metricsByDate.get(dateKey);
  if (existing) return existing;

  const created: DailyMetrics = {
    dateKey,
    uniqueContacts: new Set<string>(),
    incomingTotal: 0,
    incomingText: 0,
    incomingAudio: 0,
    otpMessages: 0,
    agentReplies: 0,
    outboundText: 0,
    outboundAudio: 0,
    meetingsScheduled: 0,
    meetingsNotifiedHuman: 0,
    openaiFailures: 0,
    errors: 0,
    openaiByModel: {}
  };
  metricsByDate.set(dateKey, created);
  return created;
}

function ensureModelUsage(metrics: DailyMetrics, model: string) {
  const key = model.trim() || "unknown_model";
  const existing = metrics.openaiByModel[key];
  if (existing) return existing;

  const created: ModelUsage = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0
  };
  metrics.openaiByModel[key] = created;
  return created;
}

export function trackInboundMessage(input: {
  fromE164: string | null | undefined;
  messageType: "text" | "audio";
}) {
  const metrics = ensureDailyMetrics();
  const from = String(input.fromE164 ?? "").trim();
  if (from) {
    metrics.uniqueContacts.add(from);
  }
  metrics.incomingTotal += 1;
  if (input.messageType === "audio") {
    metrics.incomingAudio += 1;
  } else {
    metrics.incomingText += 1;
  }
}

export function trackOtpMessage() {
  ensureDailyMetrics().otpMessages += 1;
}

export function trackAgentReplyGenerated() {
  ensureDailyMetrics().agentReplies += 1;
}

export function trackOutboundMessage(input: { messageType: "text" | "audio" }) {
  const metrics = ensureDailyMetrics();
  if (input.messageType === "audio") {
    metrics.outboundAudio += 1;
  } else {
    metrics.outboundText += 1;
  }
}

export function trackOpenAIUsage(input: OpenAIUsageInput) {
  const metrics = ensureDailyMetrics();
  const modelUsage = ensureModelUsage(metrics, input.model);
  modelUsage.requests += 1;

  const usage = input.usage ?? {};
  const inputTokens = toNumber(usage?.input_tokens ?? usage?.prompt_tokens);
  const outputTokens = toNumber(usage?.output_tokens ?? usage?.completion_tokens);
  const totalTokens = toNumber(usage?.total_tokens ?? inputTokens + outputTokens);
  const cachedInputTokens = toNumber(
    usage?.input_tokens_details?.cached_tokens ??
      usage?.prompt_tokens_details?.cached_tokens ??
      usage?.cache_read_input_tokens
  );
  const cacheWriteTokens = toNumber(
    usage?.input_tokens_details?.cache_creation_tokens ?? usage?.cache_write_input_tokens
  );

  modelUsage.inputTokens += inputTokens;
  modelUsage.outputTokens += outputTokens;
  modelUsage.totalTokens += totalTokens;
  modelUsage.cachedInputTokens += cachedInputTokens;
  modelUsage.cacheWriteTokens += cacheWriteTokens;
}

export function trackOpenAIFailure() {
  ensureDailyMetrics().openaiFailures += 1;
}

export function trackMeetingScheduled(input: MeetingRecord) {
  const metrics = ensureDailyMetrics();
  metrics.meetingsScheduled += 1;
  if (input.notifiedHuman) {
    metrics.meetingsNotifiedHuman += 1;
  }

  const dateKey = currentDateKey();
  const current = meetingsByDate.get(dateKey) ?? [];
  current.push(input);
  meetingsByDate.set(dateKey, current);
}

export function trackOperationalError() {
  ensureDailyMetrics().errors += 1;
}

function summarizeOpenAIByModel(metrics: DailyMetrics) {
  const rows = Object.entries(metrics.openaiByModel).sort((a, b) => a[0].localeCompare(b[0]));
  if (!rows.length) {
    return [{ label: "Sin consumo registrado", value: "0 tokens" }];
  }

  return rows.map(([model, usage]) => ({
    label: model,
    value: `req:${usage.requests} | in:${usage.inputTokens} | out:${usage.outputTokens} | cache:${usage.cachedInputTokens} | total:${usage.totalTokens}`
  }));
}

function buildEmailSections(dateKey: string, metrics: DailyMetrics): LuxisoftEmailSection[] {
  return [
    {
      title: "Operacion WhatsApp",
      rows: [
        { label: "Personas contactadas (unicas)", value: String(metrics.uniqueContacts.size) },
        { label: "Mensajes entrantes", value: String(metrics.incomingTotal) },
        { label: "Entrantes de texto", value: String(metrics.incomingText) },
        { label: "Entrantes de audio", value: String(metrics.incomingAudio) },
        { label: "Mensajes OTP detectados", value: String(metrics.otpMessages) },
        { label: "Respuestas generadas por Valeria", value: String(metrics.agentReplies) },
        { label: "Mensajes salientes texto", value: String(metrics.outboundText) },
        { label: "Mensajes salientes audio", value: String(metrics.outboundAudio) }
      ]
    },
    {
      title: "OpenAI - consumo por modelo",
      rows: summarizeOpenAIByModel(metrics)
    },
    {
      title: "Gestion comercial",
      rows: [
        { label: "Reuniones agendadas", value: String(metrics.meetingsScheduled) },
        { label: "Reuniones notificadas a agente humano", value: String(metrics.meetingsNotifiedHuman) },
        { label: "Errores operativos", value: String(metrics.errors) },
        { label: "Errores OpenAI", value: String(metrics.openaiFailures) },
        { label: "Fecha de corte", value: dateLabelForReport(dateKey) }
      ]
    }
  ];
}

function meetingNotes(dateKey: string) {
  const meetings = meetingsByDate.get(dateKey) ?? [];
  if (!meetings.length) {
    return ["No se registraron reuniones agendadas en la fecha de corte."];
  }

  return meetings.slice(0, 25).map((meeting, index) => {
    const time = meeting.meetingTime ? ` ${meeting.meetingTime}` : "";
    return `${index + 1}. ${meeting.contactName} (${meeting.company}) | ${meeting.userPhone} | ${meeting.contactEmail} | ${meeting.meetingDay} ${meeting.meetingDate}${time} | Motivo: ${meeting.reason}`;
  });
}

function buildReportPdfBuffer(input: {
  dateKey: string;
  metrics: DailyMetrics;
  notes: string[];
}) {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    doc.fontSize(20).text(`Report WhatsApp - ${dateLabelForReport(input.dateKey)}`, {
      align: "left"
    });
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor("#475569").text("LuxiSoft - Resumen operativo diario", {
      align: "left"
    });
    doc.moveDown(0.7);

    const lines = [
      `Personas contactadas (unicas): ${input.metrics.uniqueContacts.size}`,
      `Mensajes entrantes: ${input.metrics.incomingTotal} (texto ${input.metrics.incomingText} | audio ${input.metrics.incomingAudio})`,
      `Mensajes OTP detectados: ${input.metrics.otpMessages}`,
      `Respuestas de Valeria: ${input.metrics.agentReplies}`,
      `Salientes texto/audio: ${input.metrics.outboundText}/${input.metrics.outboundAudio}`,
      `Reuniones agendadas: ${input.metrics.meetingsScheduled}`,
      `Notificadas a humano: ${input.metrics.meetingsNotifiedHuman}`,
      `Errores operativos: ${input.metrics.errors}`,
      `Errores OpenAI: ${input.metrics.openaiFailures}`
    ];

    for (const line of lines) {
      doc.fontSize(11).fillColor("#0f172a").text(`- ${line}`);
    }

    doc.moveDown(0.8);
    doc.fontSize(13).fillColor("#0f172a").text("OpenAI por modelo");
    const modelRows = Object.entries(input.metrics.openaiByModel);
    if (!modelRows.length) {
      doc.fontSize(11).fillColor("#475569").text("- Sin consumo registrado");
    } else {
      for (const [model, usage] of modelRows) {
        doc
          .fontSize(11)
          .fillColor("#0f172a")
          .text(
            `- ${model}: req ${usage.requests} | input ${usage.inputTokens} | output ${usage.outputTokens} | cache ${usage.cachedInputTokens} | total ${usage.totalTokens}`
          );
      }
    }

    doc.moveDown(0.8);
    doc.fontSize(13).fillColor("#0f172a").text("Reuniones agendadas");
    for (const note of input.notes) {
      doc.fontSize(10).fillColor("#334155").text(`- ${note}`);
    }

    doc.end();
  });
}

function smtpConfigured() {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass && (env.smtpFrom || env.smtpUser));
}

async function sendDailyReportEmail(input: {
  dateKey: string;
  sections: LuxisoftEmailSection[];
  notes: string[];
  pdfBuffer: Buffer;
}) {
  if (!smtpConfigured()) {
    throw new Error("smtp_not_configured");
  }

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass
    }
  });

  const reportDate = dateLabelForReport(input.dateKey);
  const html = await render(
    createElement(WhatsappDailyReportEmail, {
      reportDate,
      logoUrl: env.reportLogoUrl,
      sections: input.sections,
      notes: input.notes
    })
  );

  await transporter.sendMail({
    from: env.smtpFrom || env.smtpUser,
    to: env.reportEmailTo,
    subject: `Report WhatsApp - ${reportDate}`,
    html,
    attachments: [
      {
        filename: `report-whatsapp-${input.dateKey}.pdf`,
        content: input.pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  });
}

async function notifyHumanReportStatus(message: string) {
  if (!env.humanTransferNumber) return;
  await sendWhatsappText(env.humanTransferNumber, message);
}

export async function sendDailyReportForDate(dateKey = currentDateKey()) {
  const metrics = ensureDailyMetrics(dateKey);
  const sections = buildEmailSections(dateKey, metrics);
  const notes = meetingNotes(dateKey);
  const pdfBuffer = await buildReportPdfBuffer({ dateKey, metrics, notes });
  await sendDailyReportEmail({ dateKey, sections, notes, pdfBuffer });

  metricsByDate.delete(dateKey);
  meetingsByDate.delete(dateKey);
}

export async function runScheduledDailyReport() {
  const dateKey = currentDateKey();

  try {
    await sendDailyReportForDate(dateKey);
    await notifyHumanReportStatus(
      `Reporte diario de WhatsApp enviado a ${env.reportEmailTo} (corte ${dateLabelForReport(dateKey)}).`
    );
    loggerRef.info({ dateKey }, "Daily report email sent");
  } catch (err: any) {
    loggerRef.error({ err, dateKey }, "Daily report email failed");
    try {
      await notifyHumanReportStatus(
        `Fallo el envio del reporte diario de WhatsApp (corte ${dateLabelForReport(dateKey)}).`
      );
    } catch (notifyErr: any) {
      loggerRef.warn({ notifyErr, dateKey }, "Daily report failure notification failed");
    }
  }
}

export function startDailyReportScheduler(logger?: LoggerLike) {
  if (reportTask) return;
  if (logger) loggerRef = logger;

  if (!cron.validate(env.reportCron)) {
    loggerRef.error({ reportCron: env.reportCron }, "Invalid REPORT_CRON expression");
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
    {
      timezone: env.reportTimezone
    }
  );

  loggerRef.info(
    { reportCron: env.reportCron, reportTimezone: env.reportTimezone, reportEmailTo: env.reportEmailTo },
    "Daily report scheduler started"
  );
}

export function stopDailyReportScheduler() {
  if (!reportTask) return;
  reportTask.stop();
  reportTask.destroy();
  reportTask = null;
}
