export function upgradeAdvisorWebhook(source) {
 const once=(a,b)=>{if(source.split(a).length!==2)throw Error('response_anchor_drift:'+a.slice(0,50));source=source.replace(a,b);};
 source='import {composeAdvisorReply} from "../lib/agents/advisorResponse.js";\n'+source;
 once('    let inboxConversation: InboxConversation | null = null;', '    let inboxConversation: InboxConversation | null = null;\n    let firstContact=false;');
 const anchor=source.includes('      history = await loadCustomerConversationContext')?'      history = await loadCustomerConversationContext':'      const history = await loadConversationHistory';
 once(anchor,`      if(env.defaultProject==='luxisoft') {
        try {
          const sent = await fastify.pg.query("select exists(select 1 from whatsapp_inbox_messages m join whatsapp_inbox_conversations c on c.id=m.conversation_id where c.id=$1 and c.project_key=$2 and c.channel='whatsapp' and c.contact_key=$3 and m.actor='ai' and m.direction='outbound' and m.delivery_status in ('sent','delivered','read')) as introduced",[inboxConversation.id,env.defaultProject,to]);
          firstContact=sent.rows[0]?.introduced===false;
        } catch { fastify.log.warn('advisor_introduction_state_unavailable'); }
      }
`+anchor);
 once('      const result = await handleAgentMessage({','      const result = await handleAgentMessage({\n        firstContact,');
 const a=source.includes('      const reply = guardUnsupportedPlanCharges(')?'      const reply = guardUnsupportedPlanCharges(':'      const reply = result.text?.trim();';once(a,a.replace('const reply','let reply'));
 const b=source.includes('      if (!reply) throw')?'      if (!reply) throw new Error("agent_empty_response");':'      if (!reply) return false;';
 once(b,"      if(env.defaultProject==='luxisoft') reply=composeAdvisorReply(reply??'',userMessage,firstContact,locale);\n"+b);
 if(source.includes('      if (inboxConversation && env.defaultProject === "luxisoft" && allowWelcome) {')) {
  once('        const content = err instanceof AiProviderError','        let content = err instanceof AiProviderError');
  once('        const sent = await safeReply(to, content, replyToMessageId, { quote: false });',"        content=composeAdvisorReply(content,userMessage,firstContact,locale);\n        const sent = await safeReply(to, content, replyToMessageId, { quote: false });");
 }
 // Route uses the same intent policy as tool guards, only for corporate WhatsApp.
 if(source.includes('if (!requestsCommercialFollowup(userMessage, history))')){
  source='import {advisorPolicy} from "../lib/agents/advisorPolicy.js";\n'+source;
  once('if (!requestsCommercialFollowup(userMessage, history))','if (!(env.defaultProject===\'luxisoft\'?advisorPolicy(userMessage,history).followup:requestsCommercialFollowup(userMessage, history)))');
 }
 return source;
}
