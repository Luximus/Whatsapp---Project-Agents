import type { FastifyInstance } from "fastify";
import type { InboxConversation } from "./inbox.js";
import { sendWhatsappTemplate, sendWhatsappText } from "./whatsapp.js";

const commercialPhone = "+573019289464";
export async function notifyWebsiteOpportunity(
  app: FastifyInstance,
  conversation: InboxConversation,
  order: string,
  months: number,
  total: number
) {
  const marker = `website-interest:${order}:${months}`;
  const link =
    "https://luxisoft.com/es/plataforma/whatsapp?tab=bandeja&conversation=" + conversation.id;
  const name = [conversation.displayName, conversation.contactKey].filter(Boolean).join(" ");
  const price = "$" + new Intl.NumberFormat("es-CO").format(total);
  const body = `${name} quiere contratar el clon por ${months} meses. Total: ${price} COP. Puedes revisar o tomar el chat en ${link}`;
  const claimed = await app.pg.query(
    "INSERT INTO whatsapp_website_notices(marker,project_key,phone,payload,status) VALUES($1,'luxisoft',$2,$3,'sending') ON CONFLICT DO NOTHING RETURNING marker",
    [marker, commercialPhone, JSON.stringify({ conversationId: conversation.id, body })]
  );
  if (!claimed.rowCount) return;
  await app.pg.query(
    "UPDATE whatsapp_inbox_conversations SET metadata=metadata || jsonb_build_object('websiteOpportunity',$2::jsonb) WHERE id=$1",
    [conversation.id, JSON.stringify({ months, total })]
  );
  const recipient = await app.pg.query(
    "SELECT last_inbound_at > now()-interval '24 hours' AS open FROM whatsapp_inbox_conversations WHERE project_key='luxisoft' AND channel='whatsapp' AND contact_key=$1",
    [commercialPhone]
  );
  let status = "sent";
  try {
    if (recipient.rows[0]?.open) await sendWhatsappText(commercialPhone, body);
    else
      await sendWhatsappTemplate({
        toE164: commercialPhone,
        name: "luxisoft_aviso_oportunidad_comercial",
        languageCode: "es",
        components: [
          {
            type: "body",
            parameters: [name, String(months), price, link].map((text) => ({ type: "text", text }))
          }
        ]
      });
  } catch {
    status = "needs_review";
  }
  await app.pg.query("UPDATE whatsapp_website_notices SET status=$2 WHERE marker=$1", [
    marker,
    status
  ]);
}
