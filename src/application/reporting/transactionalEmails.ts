import { createElement } from "react";
import { render } from "@react-email/render";
import { env } from "../../config/env.js";
import LuxisoftEmailTemplate from "../../emails/templates/LuxisoftEmailTemplate.js";
import type { LuxisoftEmailSection } from "../../emails/templates/LuxisoftEmailTemplate.js";
import { createSmtpTransport, isSmtpConfigured } from "../../infrastructure/messaging/mailer.js";
import { currentDateKey } from "../../domain/reporting/tracker.js";
import type {
  MeetingQuoteEmailInput,
  SupportTicketEmailInput,
  ProjectFollowupEmailInput
} from "../../domain/reporting/types.js";
import { dateLabelForReport } from "./generatePdf.js";

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

export function setTransactionalEmailLogger(logger: LoggerLike) {
  loggerRef = logger;
}

// ─── Section builders ─────────────────────────────────────────────────────────

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

// ─── Senders ──────────────────────────────────────────────────────────────────

export async function sendMeetingQuoteEmail(input: MeetingQuoteEmailInput) {
  if (!isSmtpConfigured()) {
    loggerRef.warn(
      { to: env.meetingQuoteEmailTo },
      "Meeting quote email skipped: SMTP not configured"
    );
    return { ok: false, sent: false, error: "smtp_not_configured" };
  }

  const transporter = createSmtpTransport();
  const dateLabel = dateLabelForReport(currentDateKey());
  const sections = buildMeetingQuoteSections(input, dateLabel);
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
      notes: [
        `Generado: ${new Date().toISOString()}`,
        `Notificado a agente humano por WhatsApp: ${input.notifiedHuman ? "si" : "no"}`
      ]
    })
  );
  const text = `Nuevo agendamiento desde WhatsApp\n\nProyecto: ${input.projectKey}\nNombre: ${input.contactName}\nEmpresa: ${input.company}\nCorreo: ${input.contactEmail}\nTelefono: ${input.userPhone}\nDia: ${input.meetingDay}\nFecha: ${input.meetingDate}\nHora: ${input.meetingTime || "(sin dato)"}\nMotivo: ${input.reason}\nGenerado: ${new Date().toISOString()}`;

  try {
    await transporter.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: env.meetingQuoteEmailTo,
      subject: `Lead WhatsApp - Reunion agendada - ${dateLabel}`,
      html,
      text
    });
    loggerRef.info(
      { to: env.meetingQuoteEmailTo, projectKey: input.projectKey, userPhone: input.userPhone },
      "Meeting quote email sent"
    );
    return { ok: true, sent: true };
  } catch (err: any) {
    loggerRef.error({ err, to: env.meetingQuoteEmailTo }, "Meeting quote email failed");
    return {
      ok: false,
      sent: false,
      error: String(err?.message ?? "meeting_quote_email_failed")
    };
  }
}

export async function sendSupportTicketEmail(input: SupportTicketEmailInput) {
  if (!isSmtpConfigured()) {
    loggerRef.warn(
      { to: env.supportTicketEmailTo },
      "Support ticket email skipped: SMTP not configured"
    );
    return { ok: false, sent: false, error: "smtp_not_configured" };
  }

  const transporter = createSmtpTransport();
  const dateLabel = dateLabelForReport(currentDateKey());
  const sections = buildSupportTicketSections(input, dateLabel);
  const transcript = Array.isArray(input.transcript) ? input.transcript.filter(Boolean) : [];
  const notes = [`Generado: ${new Date().toISOString()}`, ...transcript.slice(0, 8)];
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
  const text = `Nuevo ticket de soporte desde WhatsApp\n\nFecha: ${dateLabel}\nProyecto: ${input.projectKey}\nTipo: ${input.topic}\nNombre: ${input.contactName}\nEmpresa: ${input.company}\nCorreo: ${input.contactEmail}\nTelefono: ${input.userPhone}\nResumen: ${input.summary}\nGenerado: ${new Date().toISOString()}`;

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
    loggerRef.error({ err, to: env.supportTicketEmailTo }, "Support ticket email failed");
    return {
      ok: false,
      sent: false,
      error: String(err?.message ?? "support_ticket_email_failed")
    };
  }
}

export async function sendProjectFollowupEmail(input: ProjectFollowupEmailInput) {
  if (!isSmtpConfigured()) {
    loggerRef.warn(
      { to: env.supportTicketEmailTo },
      "Project follow-up email skipped: SMTP not configured"
    );
    return { ok: false, sent: false, error: "smtp_not_configured" };
  }

  const transporter = createSmtpTransport();
  const dateLabel = dateLabelForReport(currentDateKey());
  const sections = buildProjectFollowupSections(input, dateLabel);
  const notes = [
    `Generado: ${new Date().toISOString()}`,
    input.contactEmail
      ? "El contacto ya compartio correo para respuesta."
      : "El seguimiento se registro solo con el numero de WhatsApp."
  ];
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
  const text = `Nuevo seguimiento de proyecto desde WhatsApp\n\nProyecto tecnico: ${input.projectKey}\nProyecto consultado: ${input.projectName}\nNombre: ${input.contactName}\nEmpresa: ${input.company}\nCorreo: ${input.contactEmail}\nTelefono: ${input.userPhone}\nUrgencia: ${input.urgency || "(sin dato)"}\nResumen: ${input.summary}\nGenerado: ${new Date().toISOString()}`;

  try {
    await transporter.sendMail({
      from: env.smtpFrom || env.smtpUser,
      to: env.supportTicketEmailTo,
      subject: `Seguimiento de proyecto - ${input.projectName || input.projectKey} - ${dateLabel}`,
      html,
      text
    });
    loggerRef.info(
      { to: env.supportTicketEmailTo, projectKey: input.projectKey },
      "Project follow-up email sent"
    );
    return { ok: true, sent: true };
  } catch (err: any) {
    loggerRef.error({ err, to: env.supportTicketEmailTo }, "Project follow-up email failed");
    return {
      ok: false,
      sent: false,
      error: String(err?.message ?? "project_followup_email_failed")
    };
  }
}
