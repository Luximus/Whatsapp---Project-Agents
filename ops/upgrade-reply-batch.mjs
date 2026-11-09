/** Narrow upgrade shared by main and the runtime overlay. Fails if anchors drift. */
export function upgradeWebhook(source) {
  const once = (a,b) => { if (source.split(a).length !== 2) throw Error('webhook_anchor_drift:'+a.slice(0,60)); source=source.replace(a,b); };
  source='import { replyBatch } from "../lib/replyBatch.js";\n'+source;
  once('    let inboxConversation: InboxConversation | null = null;', '    let inboxConversation: InboxConversation | null = null;\n    let batch: ReturnType<typeof replyBatch> | null = null;');
  once('      inboxConversation = await recordInboxInbound', '      inboxConversation = await recordInboxInbound');
  // Insert before history loading, after inbound persistence and human ownership checks.
  const anchor=source.includes('      const commercialProject =')?'      const commercialProject =':'      const history = await loadConversationHistory';
  once(anchor,`      const prepareBatchActions = (actions: AgentActions) => {
        const transfer = actions.escalateToHuman;
        if (transfer) actions.escalateToHuman = async input => {
          const result = await transfer(input);
          if (result.ok) batch?.confirmOwnHandoff();
          return result;
        };
        return actions;
      };
      if (env.defaultProject === "luxisoft" && replyToMessageId) {
        batch = replyBatch(fastify.pg,env.defaultProject,inboxConversation.id,to,replyToMessageId);
        if (!await batch.ready()) return true;
        userMessage = await batch.text(userMessage);
      }
`+anchor);
  if (source.includes('const actions = website.withActions(buildAgentActions(to, locale, inboxConversation, userMessage, history));')) {
    once('const actions = website.withActions(buildAgentActions(to, locale, inboxConversation, userMessage, history));','const actions = prepareBatchActions(website.withActions(buildAgentActions(to, locale, inboxConversation, userMessage, history)));');
  } else {
    once('actions: buildAgentActions(to, locale, inboxConversation)','actions: prepareBatchActions(buildAgentActions(to, locale, inboxConversation))');
  }
  once('      const result = await handleAgentMessage({','      const result = await handleAgentMessage({\n        isSuperseded: batch?.newer,');
  const replyAnchor=source.includes('      const reply = guardUnsupportedPlanCharges(')?'      const reply = guardUnsupportedPlanCharges(':'      const reply = result.text?.trim();';
  once(replyAnchor,'      if (batch && await batch.newer()) return true;\n'+replyAnchor);
  once('const tryReplyWithVoice = async (to: string, message: string): Promise<boolean> => {','const tryReplyWithVoice = async (to: string, message: string, canSend?: () => Promise<boolean>): Promise<boolean> => {');
  once('      await sendWhatsappAudio(', '      if (canSend && !await canSend()) return false;\n      await sendWhatsappAudio(');
  once('sent = await tryReplyWithVoice(to, reply);','sent = await tryReplyWithVoice(to, reply, async()=>!batch || !await batch.newer());');
  once('      if (!sent) {\n        sent = await safeReply(to, reply,','      if (!sent) {\n        if (batch && await batch.newer()) return true;\n        sent = await safeReply(to, reply,');
  once('        for (const block of result.rich) {','        for (const block of result.rich) {\n          if (batch && await batch.newer()) break;');
  // No fallback from an obsolete turn, even if its model/tool failed.
  once('      trackOperationalError();\n      if (inboxConversation) {','      if (batch && await batch.newer()) return true;\n      trackOperationalError();\n      if (inboxConversation) {');
  return source;
}
