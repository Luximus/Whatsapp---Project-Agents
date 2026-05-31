import cron, { type ScheduledTask } from "node-cron";
import { render } from "@react-email/render";
import nodemailer from "nodemailer";
import PDFDocument from "pdfkit";
import { createElement } from "react";
import { env } from "../env.js";
import { WhatsappDailyReportEmail } from "../emails/templates/WhatsappDailyReportEmail.js";
import LuxisoftEmailTemplate, {
  type LuxisoftEmailHighlight,
  type LuxisoftEmailSection
} from "../emails/templates/LuxisoftEmailTemplate.js";

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
  outboundText: number;
  outboundAudio: number;
  meetingsScheduled: number;
  meetingsNotifiedHuman: number;
  supportTicketsCreated: number;
  openaiFailures: number;
  errors: number;
  openaiByModel: Record<string, ModelUsage>;
};

type OpenAIUsageInput = {
  model: string;
  usage: Record<string, any> | null | undefined;
};

type MeetingQuoteEmailInput = {
  projectKey: string;
  userPhone: string;
  contactName: string;
  contactEmail: string;
  company: string;
  meetingDay: string;
  meetingDate: string;
  meetingTime: string | null;
  reason: string;
  notifiedHuman: boolean;
};

type SupportTicketEmailInput = {
  projectKey: string;
  userPhone: string;
  contactName: string;
  contactEmail: string;
  company: string;
  topic: string;
  summary: string;
  transcript?: string[];
};

type ProjectFollowupEmailInput = {
  projectKey: string;
  projectName: string;
  userPhone: string;
  contactName: string;
  contactEmail: string;
  company: string;
  summary: string;
  urgency: string | null;
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

// Separadores de miles para que las cifras grandes (tokens, mensajes) se lean
// bien tanto en el correo como en el PDF.
function formatInt(value: number) {
  return Math.round(toNumber(value)).toLocaleString("es-CO");
}

function percent(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function aggregateOpenAI(metrics: DailyMetrics): ModelUsage {
  return Object.values(metrics.openaiByModel).reduce<ModelUsage>(
    (acc, usage) => ({
      requests: acc.requests + usage.requests,
      inputTokens: acc.inputTokens + usage.inputTokens,
      outputTokens: acc.outputTokens + usage.outputTokens,
      cachedInputTokens: acc.cachedInputTokens + usage.cachedInputTokens,
      cacheWriteTokens: acc.cacheWriteTokens + usage.cacheWriteTokens,
      totalTokens: acc.totalTokens + usage.totalTokens
    }),
    {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0
    }
  );
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
    outboundText: 0,
    outboundAudio: 0,
    meetingsScheduled: 0,
    meetingsNotifiedHuman: 0,
    supportTicketsCreated: 0,
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

export function trackSupportTicketCreated() {
  ensureDailyMetrics().supportTicketsCreated += 1;
}

export function trackOperationalError() {
  ensureDailyMetrics().errors += 1;
}

function buildOpenAISectionRows(metrics: DailyMetrics) {
  const models = Object.entries(metrics.openaiByModel).sort((a, b) => a[0].localeCompare(b[0]));
  if (!models.length) {
    return [{ label: "Sin consumo registrado", value: "0 tokens" }];
  }

  const totals = aggregateOpenAI(metrics);
  const rows = [
    { label: "Solicitudes totales", value: formatInt(totals.requests) },
    {
      label: "Tokens entrada / salida",
      value: `${formatInt(totals.inputTokens)} / ${formatInt(totals.outputTokens)}`
    },
    { label: "Tokens en caché", value: formatInt(totals.cachedInputTokens) },
    { label: "Tokens totales", value: formatInt(totals.totalTokens) }
  ];

  for (const [model, usage] of models) {
    rows.push({
      label: model,
      value: `${formatInt(usage.totalTokens)} tokens · ${formatInt(usage.requests)} req`
    });
  }

  return rows;
}

function buildDailyHighlights(metrics: DailyMetrics): LuxisoftEmailHighlight[] {
  const totals = aggregateOpenAI(metrics);
  const audioShare = percent(metrics.incomingAudio, metrics.incomingTotal);
  return [
    {
      label: "Contactos únicos",
      value: formatInt(metrics.uniqueContacts.size)
    },
    {
      label: "Mensajes entrantes",
      value: formatInt(metrics.incomingTotal),
      hint: `${formatInt(metrics.incomingAudio)} de audio (${audioShare}%)`
    },
    {
      label: "Reuniones agendadas",
      value: formatInt(metrics.meetingsScheduled),
      hint: metrics.supportTicketsCreated
        ? `${formatInt(metrics.supportTicketsCreated)} tickets de soporte`
        : undefined
    },
    {
      label: "Tokens de IA",
      value: formatInt(totals.totalTokens),
      hint: `${formatInt(totals.requests)} solicitudes`
    }
  ];
}

function buildEmailSections(dateKey: string, metrics: DailyMetrics): LuxisoftEmailSection[] {
  return [
    {
      title: "Operación WhatsApp",
      rows: [
        { label: "Personas contactadas (únicas)", value: formatInt(metrics.uniqueContacts.size) },
        { label: "Mensajes entrantes", value: formatInt(metrics.incomingTotal) },
        { label: "Entrantes de texto", value: formatInt(metrics.incomingText) },
        { label: "Entrantes de audio", value: formatInt(metrics.incomingAudio) },
        { label: "Mensajes OTP detectados", value: formatInt(metrics.otpMessages) },
        { label: "Mensajes salientes texto", value: formatInt(metrics.outboundText) },
        { label: "Mensajes salientes audio", value: formatInt(metrics.outboundAudio) }
      ]
    },
    {
      title: "Consumo de IA",
      rows: buildOpenAISectionRows(metrics)
    },
    {
      title: "Gestión comercial",
      rows: [
        { label: "Reuniones agendadas", value: formatInt(metrics.meetingsScheduled) },
        {
          label: "Reuniones notificadas a agente humano",
          value: formatInt(metrics.meetingsNotifiedHuman)
        },
        { label: "Tickets de soporte creados", value: formatInt(metrics.supportTicketsCreated) },
        { label: "Errores operativos", value: formatInt(metrics.errors) },
        { label: "Errores de IA", value: formatInt(metrics.openaiFailures) },
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

function buildReportPdfBuffer(input: { dateKey: string; metrics: DailyMetrics; notes: string[] }) {
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

    const m = input.metrics;
    const lines = [
      `Personas contactadas (únicas): ${formatInt(m.uniqueContacts.size)}`,
      `Mensajes entrantes: ${formatInt(m.incomingTotal)} (texto ${formatInt(m.incomingText)} | audio ${formatInt(m.incomingAudio)})`,
      `Mensajes OTP detectados: ${formatInt(m.otpMessages)}`,
      `Salientes texto/audio: ${formatInt(m.outboundText)}/${formatInt(m.outboundAudio)}`,
      `Reuniones agendadas: ${formatInt(m.meetingsScheduled)}`,
      `Notificadas a humano: ${formatInt(m.meetingsNotifiedHuman)}`,
      `Tickets de soporte creados: ${formatInt(m.supportTicketsCreated)}`,
      `Errores operativos: ${formatInt(m.errors)}`,
      `Errores de IA: ${formatInt(m.openaiFailures)}`
    ];

    for (const line of lines) {
      doc.fontSize(11).fillColor("#0f172a").text(`- ${line}`);
    }

    doc.moveDown(0.8);
    doc.fontSize(13).fillColor("#0f172a").text("Consumo de IA por modelo");
    const modelRows = Object.entries(input.metrics.openaiByModel);
    if (!modelRows.length) {
      doc.fontSize(11).fillColor("#475569").text("- Sin consumo registrado");
    } else {
      const totals = aggregateOpenAI(input.metrics);
      doc
        .fontSize(11)
        .fillColor("#0f172a")
        .text(
          `- Totales: req ${formatInt(totals.requests)} | input ${formatInt(totals.inputTokens)} | output ${formatInt(totals.outputTokens)} | cache ${formatInt(totals.cachedInputTokens)} | total ${formatInt(totals.totalTokens)}`
        );
      for (const [model, usage] of modelRows) {
        doc
          .fontSize(11)
          .fillColor("#0f172a")
          .text(
            `- ${model}: ${formatInt(usage.totalTokens)} tokens | ${formatInt(usage.requests)} req`
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

function buildMeetingQuoteEmailBody(input: MeetingQuoteEmailInput) {
  const submittedAt = new Date().toISOString();
  return [
    "Nuevo agendamiento desde WhatsApp",
    "",
    `Proyecto: ${input.projectKey || "(sin dato)"}`,
    `Nombre: ${input.contactName || "(sin dato)"}`,
    `Empresa: ${input.company || "(sin dato)"}`,
    `Correo: ${input.contactEmail || "(sin dato)"}`,
    `Telefono WhatsApp: ${input.userPhone || "(sin dato)"}`,
    `Dia reunion: ${input.meetingDay || "(sin dato)"}`,
    `Fecha reunion: ${input.meetingDate || "(sin dato)"}`,
    `Hora reunion: ${input.meetingTime || "(sin dato)"}`,
    `Motivo: ${input.reason || "(sin dato)"}`,
    `Notificado a agente humano por WhatsApp: ${input.notifiedHuman ? "si" : "no"}`,
    "",
    `Generado: ${submittedAt}`
  ].join("\n");
}

function buildMeetingQuoteSections(
  input: MeetingQuoteEmailInput,
  dateLabel: string
): LuxisoftEmailSection[] {
  return [
    {
      title: "Agendamiento",
      rows: [
        { label: "Fecha", value: dateLabel },
        { label: "Proyecto", value: input.projectKey || "(sin dato)" },
        { label: "Canal", value: "WhatsApp" },
        { label: "Tipo", value: "Reunion con especialista" }
      ]
    },
    {
      title: "Contacto",
      rows: [
        { label: "Nombre", value: input.contactName || "(sin dato)" },
        { label: "Empresa", value: input.company || "(sin dato)" },
        { label: "Correo", value: input.contactEmail || "(sin dato)" },
        { label: "Telefono", value: input.userPhone || "(sin dato)" }
      ]
    },
    {
      title: "Reunion",
      rows: [
        { label: "Dia", value: input.meetingDay || "(sin dato)" },
        { label: "Fecha", value: input.meetingDate || "(sin dato)" },
        { label: "Hora", value: input.meetingTime || "(sin dato)" },
        { label: "Motivo", value: input.reason || "(sin dato)" }
      ]
    }
  ];
}

function buildMeetingQuoteNotes(input: MeetingQuoteEmailInput) {
  return [
    `Generado: ${new Date().toISOString()}`,
    `Notificado a agente humano por WhatsApp: ${input.notifiedHuman ? "si" : "no"}`
  ];
}

function buildSupportTicketSections(
  input: SupportTicketEmailInput,
  dateLabel: string
): LuxisoftEmailSection[] {
  return [
    {
      title: "Ticket",
      rows: [
        { label: "Fecha", value: dateLabel },
        { label: "Proyecto", value: input.projectKey || "(sin dato)" },
        { label: "Canal", value: "WhatsApp" },
        { label: "Tipo", value: input.topic || "soporte" }
      ]
    },
    {
      title: "Contacto",
      rows: [
        { label: "Nombre", value: input.contactName || "(sin dato)" },
        { label: "Empresa", value: input.company || "(sin dato)" },
        { label: "Correo", value: input.contactEmail || "(sin dato)" },
        { label: "Telefono", value: input.userPhone || "(sin dato)" }
      ]
    },
    {
      title: "Solicitud",
      rows: [{ label: "Resumen", value: input.summary || "(sin dato)" }]
    }
  ];
}

function buildSupportTicketNotes(input: SupportTicketEmailInput) {
  const submittedAt = new Date().toISOString();
  const notes = [`Generado: ${submittedAt}`];
  const transcript = Array.isArray(input.transcript) ? input.transcript.filter(Boolean) : [];

  if (transcript.length) {
    notes.push("Mensajes recientes del usuario:");
    for (const item of transcript.slice(0, 8)) {
      notes.push(item);
    }
  }

  return notes;
}

function buildProjectFollowupEmailBody(input: ProjectFollowupEmailInput) {
  const submittedAt = new Date().toISOString();
  return [
    "Nuevo seguimiento de proyecto desde WhatsApp",
    "",
    `Proyecto tecnico: ${input.projectKey || "(sin dato)"}`,
    `Proyecto consultado: ${input.projectName || "(sin dato)"}`,
    `Nombre: ${input.contactName || "(sin dato)"}`,
    `Empresa: ${input.company || "(sin dato)"}`,
    `Correo: ${input.contactEmail || "(sin dato)"}`,
    `Telefono WhatsApp: ${input.userPhone || "(sin dato)"}`,
    `Urgencia: ${input.urgency || "(sin dato)"}`,
    `Resumen: ${input.summary || "(sin dato)"}`,
    "",
    `Generado: ${submittedAt}`
  ].join("\n");
}

function buildProjectFollowupSections(
  input: ProjectFollowupEmailInput,
  dateLabel: string
): LuxisoftEmailSection[] {
  return [
    {
      title: "Seguimiento",
      rows: [
        { label: "Fecha", value: dateLabel },
        { label: "Proyecto tecnico", value: input.projectKey || "(sin dato)" },
        { label: "Proyecto consultado", value: input.projectName || "(sin dato)" },
        { label: "Canal", value: "WhatsApp" }
      ]
    },
    {
      title: "Contacto",
      rows: [
        { label: "Nombre", value: input.contactName || "(sin dato)" },
        { label: "Empresa", value: input.company || "(sin dato)" },
        { label: "Correo", value: input.contactEmail || "(sin dato)" },
        { label: "Telefono", value: input.userPhone || "(sin dato)" }
      ]
    },
    {
      title: "Solicitud",
      rows: [
        { label: "Urgencia", value: input.urgency || "(sin dato)" },
        { label: "Resumen", value: input.summary || "(sin dato)" }
      ]
    }
  ];
}

function buildProjectFollowupNotes(input: ProjectFollowupEmailInput) {
  return [
    `Generado: ${new Date().toISOString()}`,
    input.contactEmail
      ? "El contacto ya compartio correo para respuesta."
      : "El seguimiento se registro solo con el numero de WhatsApp."
  ];
}

export async function sendMeetingQuoteEmail(input: MeetingQuoteEmailInput) {
  if (!smtpConfigured()) {
    loggerRef.warn(
      { to: env.meetingQuoteEmailTo },
      "Meeting quote email skipped: SMTP not configured"
    );
    return {
      ok: false,
      sent: false,
      error: "smtp_not_configured"
    };
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

  const dateKey = currentDateKey();
  const dateLabel = dateLabelForReport(dateKey);
  const subject = `Lead WhatsApp - Reunion agendada - ${dateLabelForReport(dateKey)}`;
  const sections = buildMeetingQuoteSections(input, dateLabel);
  const notes = buildMeetingQuoteNotes(input);
  const html = await render(
    createElement(LuxisoftEmailTemplate, {
      preview: `Nueva reunion WhatsApp - ${dateLabel}`,
      title: `Reunion WhatsApp - ${dateLabel}`,
      subtitle: "Solicitud de reunion con especialista",
      intro:
        "Se registro una nueva solicitud de reunion desde WhatsApp. El equipo comercial debe revisar los datos y continuar la gestion con el contacto registrado.",
      reportDateLabel: dateLabel,
      logoUrl: env.reportLogoUrl,
      sections,
      notes
    })
  );
  const text = buildMeetingQuoteEmailBody(input);

  try {
    await transporter.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: env.meetingQuoteEmailTo,
      subject,
      html,
      text
    });
    loggerRef.info(
      { to: env.meetingQuoteEmailTo, projectKey: input.projectKey, userPhone: input.userPhone },
      "Meeting quote email sent"
    );
    return { ok: true, sent: true };
  } catch (err: any) {
    loggerRef.error(
      {
        err,
        to: env.meetingQuoteEmailTo,
        projectKey: input.projectKey,
        userPhone: input.userPhone
      },
      "Meeting quote email failed"
    );
    return {
      ok: false,
      sent: false,
      error: String(err?.message ?? "meeting_quote_email_failed")
    };
  }
}

export async function sendSupportTicketEmail(input: SupportTicketEmailInput) {
  if (!smtpConfigured()) {
    loggerRef.warn(
      { to: env.supportTicketEmailTo },
      "Support ticket email skipped: SMTP not configured"
    );
    return {
      ok: false,
      sent: false,
      error: "smtp_not_configured"
    };
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

  const dateKey = currentDateKey();
  const dateLabel = dateLabelForReport(dateKey);
  const sections = buildSupportTicketSections(input, dateLabel);
  const notes = buildSupportTicketNotes(input);

  const html = await render(
    createElement(LuxisoftEmailTemplate, {
      preview: `Nuevo ticket WhatsApp - ${dateLabel}`,
      title: `Ticket WhatsApp - ${dateLabel}`,
      subtitle: "Solicitud de soporte/comercial",
      intro:
        "Se registro un nuevo ticket desde WhatsApp. El equipo de soporte debe revisar el caso y responder al contacto registrado.",
      reportDateLabel: dateLabel,
      logoUrl: env.reportLogoUrl,
      sections,
      notes
    })
  );

  const text = [
    "Nuevo ticket de soporte desde WhatsApp",
    "",
    `Fecha: ${dateLabel}`,
    `Proyecto: ${input.projectKey || "(sin dato)"}`,
    `Tipo: ${input.topic || "soporte"}`,
    `Nombre: ${input.contactName || "(sin dato)"}`,
    `Empresa: ${input.company || "(sin dato)"}`,
    `Correo: ${input.contactEmail || "(sin dato)"}`,
    `Telefono: ${input.userPhone || "(sin dato)"}`,
    `Resumen: ${input.summary || "(sin dato)"}`,
    "",
    `Generado: ${new Date().toISOString()}`
  ].join("\n");

  try {
    await transporter.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: env.supportTicketEmailTo,
      subject: `Ticket WhatsApp - ${dateLabel}`,
      html,
      text
    });

    loggerRef.info(
      { to: env.supportTicketEmailTo, projectKey: input.projectKey, userPhone: input.userPhone },
      "Support ticket email sent"
    );
    return { ok: true, sent: true };
  } catch (err: any) {
    loggerRef.error(
      {
        err,
        to: env.supportTicketEmailTo,
        projectKey: input.projectKey,
        userPhone: input.userPhone
      },
      "Support ticket email failed"
    );
    return {
      ok: false,
      sent: false,
      error: String(err?.message ?? "support_ticket_email_failed")
    };
  }
}

export async function sendProjectFollowupEmail(input: ProjectFollowupEmailInput) {
  if (!smtpConfigured()) {
    loggerRef.warn(
      { to: env.supportTicketEmailTo },
      "Project follow-up email skipped: SMTP not configured"
    );
    return {
      ok: false,
      sent: false,
      error: "smtp_not_configured"
    };
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

  const dateKey = currentDateKey();
  const dateLabel = dateLabelForReport(dateKey);
  const sections = buildProjectFollowupSections(input, dateLabel);
  const notes = buildProjectFollowupNotes(input);
  const html = await render(
    createElement(LuxisoftEmailTemplate, {
      preview: `Seguimiento de proyecto WhatsApp - ${dateLabel}`,
      title: `Seguimiento de proyecto - ${dateLabel}`,
      subtitle: "Solicitud de seguimiento urgente",
      intro:
        "Se registro una nueva solicitud de seguimiento sobre un proyecto existente desde WhatsApp. El equipo debe revisar el caso y responder por el canal correspondiente.",
      reportDateLabel: dateLabel,
      logoUrl: env.reportLogoUrl,
      sections,
      notes
    })
  );
  const text = buildProjectFollowupEmailBody(input);

  try {
    await transporter.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: env.supportTicketEmailTo,
      subject: `Seguimiento de proyecto - ${input.projectName || input.projectKey} - ${dateLabel}`,
      html,
      text
    });

    loggerRef.info(
      { to: env.supportTicketEmailTo, projectKey: input.projectKey, userPhone: input.userPhone },
      "Project follow-up email sent"
    );
    return { ok: true, sent: true };
  } catch (err: any) {
    loggerRef.error(
      {
        err,
        to: env.supportTicketEmailTo,
        projectKey: input.projectKey,
        userPhone: input.userPhone
      },
      "Project follow-up email failed"
    );
    return {
      ok: false,
      sent: false,
      error: String(err?.message ?? "project_followup_email_failed")
    };
  }
}

async function sendDailyReportEmail(input: {
  dateKey: string;
  sections: LuxisoftEmailSection[];
  highlights: LuxisoftEmailHighlight[];
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
      highlights: input.highlights,
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

export async function sendDailyReportForDate(dateKey = currentDateKey()) {
  const metrics = ensureDailyMetrics(dateKey);
  const sections = buildEmailSections(dateKey, metrics);
  const highlights = buildDailyHighlights(metrics);
  const notes = meetingNotes(dateKey);
  const pdfBuffer = await buildReportPdfBuffer({ dateKey, metrics, notes });
  await sendDailyReportEmail({ dateKey, sections, highlights, notes, pdfBuffer });

  metricsByDate.delete(dateKey);
  meetingsByDate.delete(dateKey);
}

export async function runScheduledDailyReport() {
  const dateKey = currentDateKey();

  try {
    await sendDailyReportForDate(dateKey);
    loggerRef.info({ dateKey }, "Daily report email sent");
  } catch (err: any) {
    loggerRef.error({ err, dateKey }, "Daily report email failed");
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
