import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireBridgeProjectAuth } from "../lib/bridge.js";
import { ensureInboxConversation, recordInboxOutbound } from "../lib/inbox.js";
import { sendWhatsappTemplate, sendWhatsappText } from "../lib/whatsapp.js";

const commercial = "+573019289464";
const field = z
  .string()
  .trim()
  .min(1)
  .max(350)
  .transform((v) => v.replace(/\s+/g, " "));
export const commercialPaymentsRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/bridge/billing/commercial", async (req) => {
    requireBridgeProjectAuth(req, "luxisoft");
    const b = z
      .object({
        marker: z.string().min(1).max(200),
        customer: field,
        product: field,
        price: field,
        reference: field,
        origin: field,
        orderUrl: z
          .string()
          .regex(/^https:\/\/luxisoft\.com\/api\/v1\/platform\/inbox\/payment\/[a-f0-9-]{36}$/),
        customerPhone: z
          .string()
          .regex(/^\+[1-9]\d{7,14}$/)
          .nullish(),
        conversation: z.uuid().nullish()
      })
      .strict()
      .parse(req.body);
    const staff = await ensureInboxConversation(app, {
      projectKey: "luxisoft",
      channel: "whatsapp",
      contactKey: commercial
    });
    const customer =
      b.conversation ??
      (b.customerPhone
        ? (
            await app.pg.query(
              "select id from whatsapp_inbox_conversations where project_key='luxisoft' and channel='whatsapp' and contact_key=$1",
              [b.customerPhone]
            )
          ).rows[0]?.id
        : null);
    const links =
      b.orderUrl +
      (customer
        ? " · Chat: https://luxisoft.com/es/plataforma/whatsapp?tab=bandeja&conversation=" +
          customer
        : "");
    const fields = [b.customer, b.product, b.price, b.reference, b.origin, links];
    const body =
      "Pago aprobado · " +
      b.origin +
      "\n" +
      b.customer +
      " · " +
      b.product +
      "\n" +
      b.price +
      "\nReferencia: " +
      b.reference +
      "\n" +
      links;
    const claim = await app.pg.query(
      `INSERT INTO whatsapp_website_notices(marker,project_key,phone,payload,status) VALUES($1,'luxisoft',$2,$3,'sending')
    ON CONFLICT(marker) DO UPDATE SET status='sending' WHERE whatsapp_website_notices.status='awaiting_template'
    AND (whatsapp_website_notices.payload->>'retryAfter')::timestamptz<=now() RETURNING marker`,
      [b.marker, commercial, { text: body }]
    );
    if (!claim.rowCount)
      return {
        data: {
          status: (
            await app.pg.query("select status from whatsapp_website_notices where marker=$1", [
              b.marker
            ])
          ).rows[0]?.status
        }
      };
    const outside =
      !staff.lastInboundAt || Date.now() - new Date(staff.lastInboundAt).getTime() >= 86400000;
    let status = "sent";
    try {
      const result = outside
        ? await sendWhatsappTemplate({
            toE164: commercial,
            name: "luxisoft_aviso_pago_comercial",
            languageCode: "es",
            components: [
              { type: "body", parameters: fields.map((text) => ({ type: "text", text })) }
            ]
          })
        : await sendWhatsappText(commercial, body);
      await recordInboxOutbound(app, {
        conversationId: staff.id,
        externalMessageId: result?.messages?.[0]?.id,
        actor: "system",
        content: body,
        deliveryStatus: "sent",
        metadata: { paymentMarker: b.marker }
      });
    } catch (error) {
      status =
        outside &&
        z
          .object({ details: z.object({ error: z.object({ code: z.literal(132001) }) }) })
          .safeParse(error).success
          ? "awaiting_template"
          : "needs_review";
    }
    await app.pg.query(
      "UPDATE whatsapp_website_notices SET status=$2,payload=payload||jsonb_build_object('retryAfter',now()+interval '10 minutes') WHERE marker=$1",
      [b.marker, status]
    );
    return { ok: true, data: { status } };
  });
};
