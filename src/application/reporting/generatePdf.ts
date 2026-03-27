import PDFDocument from "pdfkit";
import type { DailyMetrics } from "../../domain/reporting/types.js";

export function dateLabelForReport(dateKey: string): string {
  return dateKey.replace(/-/g, "/");
}

export function buildReportPdfBuffer(input: {
  dateKey: string;
  metrics: DailyMetrics;
  notes: string[];
}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    doc
      .fontSize(20)
      .text(`Report WhatsApp - ${dateLabelForReport(input.dateKey)}`, { align: "left" });
    doc.moveDown(0.3);
    doc
      .fontSize(11)
      .fillColor("#475569")
      .text("LuxiSoft - Resumen operativo diario", { align: "left" });
    doc.moveDown(0.7);

    const lines = [
      `Personas contactadas (unicas): ${input.metrics.uniqueContacts.size}`,
      `Mensajes entrantes: ${input.metrics.incomingTotal} (texto ${input.metrics.incomingText} | audio ${input.metrics.incomingAudio})`,
      `Mensajes OTP detectados: ${input.metrics.otpMessages}`,
      `Respuestas de Valeria: ${input.metrics.agentReplies}`,
      `Salientes texto/audio: ${input.metrics.outboundText}/${input.metrics.outboundAudio}`,
      `Reuniones agendadas: ${input.metrics.meetingsScheduled}`,
      `Notificadas a humano: ${input.metrics.meetingsNotifiedHuman}`,
      `Tickets de soporte creados: ${input.metrics.supportTicketsCreated}`,
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
        doc.fontSize(11).fillColor("#0f172a").text(
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
