import { createElement } from "react";
import { render } from "@react-email/render";
import { env } from "../../config/env.js";
import { WhatsappDailyReportEmail } from "../../emails/templates/WhatsappDailyReportEmail.js";
import type { LuxisoftEmailSection } from "../../emails/templates/LuxisoftEmailTemplate.js";
import { sendWhatsappText } from "../../infrastructure/messaging/whatsappApi.js";
import { createSmtpTransport, isSmtpConfigured } from "../../infrastructure/messaging/mailer.js";
import { currentDateKey, getDailySnapshot, flushTodayMetricsToDb } from "../../domain/reporting/tracker.js";
import type { DailyMetrics } from "../../domain/reporting/types.js";
import { dateLabelForReport, buildReportPdfBuffer } from "./generatePdf.js";

type LoggerLike = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

let loggerRef: LoggerLike = {
  info: (obj, msg) => console.log(msg ?? "", obj ?? ""),
  warn: (obj, msg) => console.warn(msg ?? "", obj ?? ""),
  error: (obj, msg) => console.error(msg ?? "", obj ?? "")
};

export function setDailyReportLogger(logger: LoggerLike) {
  loggerRef = logger;
}

// ─── Builders ─────────────────────────────────────────────────────────────────

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
        {
          label: "Reuniones notificadas a agente humano",
          value: String(metrics.meetingsNotifiedHuman)
        },
        { label: "Tickets de soporte creados", value: String(metrics.supportTicketsCreated) },
        { label: "Errores operativos", value: String(metrics.errors) },
        { label: "Errores OpenAI", value: String(metrics.openaiFailures) },
        { label: "Fecha de corte", value: dateLabelForReport(dateKey) }
      ]
    }
  ];
}

function buildMeetingNotes(
  meetings: ReturnType<typeof getDailySnapshot>["meetings"]
): string[] {
  if (!meetings.length) {
    return ["No se registraron reuniones agendadas en la fecha de corte."];
  }
  return meetings.slice(0, 25).map((meeting, index) => {
    const time = meeting.meetingTime ? ` ${meeting.meetingTime}` : "";
    return `${index + 1}. ${meeting.contactName} (${meeting.company}) | ${meeting.userPhone} | ${meeting.contactEmail} | ${meeting.meetingDay} ${meeting.meetingDate}${time} | Motivo: ${meeting.reason}`;
  });
}

// ─── Sending ──────────────────────────────────────────────────────────────────

async function sendDailyReportEmail(input: {
  dateKey: string;
  sections: LuxisoftEmailSection[];
  notes: string[];
  pdfBuffer: Buffer;
}) {
  if (!isSmtpConfigured()) throw new Error("smtp_not_configured");

  const transporter = createSmtpTransport();
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
  await flushTodayMetricsToDb();
  const { metrics, meetings } = getDailySnapshot(dateKey);
  const sections = buildEmailSections(dateKey, metrics);
  const notes = buildMeetingNotes(meetings);
  const pdfBuffer = await buildReportPdfBuffer({ dateKey, metrics, notes });
  await sendDailyReportEmail({ dateKey, sections, notes, pdfBuffer });
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
