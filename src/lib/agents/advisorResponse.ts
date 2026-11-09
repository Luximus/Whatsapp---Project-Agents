import type {ChatMessage} from '../ai/types.js';
export const plain = (s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const greeting=/^(?:hola|buenas?(?: n[oó]?ches?| tardes?)?|buenos d[ií]as|buen d[ií]a|hello|hi|hey|good (?:morning|afternoon|evening)|ol[aá]|oi|bom dia|boa (?:tarde|noite))(?=$|[!,.:;\s])[!,.:;\s]*/iu;
export const onlyGreeting=(s:string)=>greeting.test(plain(s))&&!plain(s).replace(greeting,'').replace(/[!.,\s]+/g,'');
const identityRequest=(raw:string)=>/quien eres|como te llamas|who are you|your name|qual.*nome/i.test(plain(raw));
const quotedRequest=(raw:string)=>/redact|traduc|traduza|translate|write.*message|escribe.*mensaje|ejemplo.*saludo|cita textual/i.test(raw);
export function advisorOpening(raw:string,locale:string,now=new Date()) {
 const s=plain(raw), hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Bogota',hour:'2-digit',hourCycle:'h23'}).format(now));
 const period=/buenas? n[oó]?ches?|good evening|boa noite/.test(s)?'night':/buenas tardes?|good afternoon|boa tarde/.test(s)?'afternoon':/buenos dias|buen dia|good morning|bom dia/.test(s)?'morning':hour<5||hour>=19?'night':hour>=12?'afternoon':'morning';
 return ({es:{morning:'Buenos días',afternoon:'Buenas tardes',night:'Buenas noches'},en:{morning:'Good morning',afternoon:'Good afternoon',night:'Good evening'},pt:{morning:'Bom dia',afternoon:'Boa tarde',night:'Boa noite'}}[locale as 'es'|'en'|'pt']??{morning:'Buenos días',afternoon:'Buenas tardes',night:'Buenas noches'})[period];
}
export function cleanAdvisorBody(text:string,raw:string) {
 if(quotedRequest(raw)||identityRequest(raw)) return text.trim();
 let body=text.trim();
 // Only remove conversational openings, never occurrences inside facts or quotes.
 for(let i=0;i<4;i++) {
  const before=body;
  body=body.replace(greeting,'').trim().replace(/^(?:soy|me llamo|i am|i'm|sou)\s+Luisa(?:,?\s*(?:asistente|assistente|the (?:virtual )?sales assistant)[^!?\n]{0,100}?LUXISOFT S\.A\.S\.)?[.!,:]?\s*/iu,'').trim().replace(/^(?:¿?C[oó]mo te encuentras\?|How are you\?|Como voc[eê] est[aá]\?)\s*/iu,'');
  if(body===before)break;
 }
 const seen=new Set<string>();
 const sentences=new Set<string>();
 return body.split(/\n\s*\n/).filter(p=>{const key=plain(p);if(seen.has(key))return false;seen.add(key);return true;}).map(p=>[...new Intl.Segmenter('es',{granularity:'sentence'}).segment(p)].filter(({segment})=>{const key=plain(segment);if(key.length<15)return true;if(sentences.has(key))return false;sentences.add(key);return true;}).map(s=>s.segment).join('').trim()).filter(Boolean).join('\n\n');
}
export function asksAboutAutomation(raw:string) {
 return /(?:eres|sos|usted es|hablando|hablo|are you|is this|voce e).{0,40}\b(?:bot|robot|ia|ai|humano?|humana|persona|person|human|automatiz\w*|virtual)\b/i.test(plain(raw));
}
export function composeAdvisorReply(text:string,raw:string,firstContact:boolean,locale:string,now=new Date()) {
 if(asksAboutAutomation(raw)) return locale==='en'?'I am an automated assistant for LUXISOFT S.A.S., not a person. I can help you or connect you with the team.':locale==='pt'?'Sou uma assistente automatizada da LUXISOFT S.A.S., não uma pessoa. Posso ajudar ou encaminhar você à equipe.':'Soy un asistente automatizado de LUXISOFT S.A.S., no una persona. Puedo orientarte o ayudarte a contactar al equipo.';
 const body=cleanAdvisorBody(text,raw);
 const opening=advisorOpening(raw,locale,now);
 if(!firstContact)return onlyGreeting(raw)?opening+'.':body;
 const identity=locale==='en'?`${opening}, I'm Luisa, the sales assistant at LUXISOFT S.A.S.`:locale==='pt'?`${opening}, sou Luisa, assistente comercial da LUXISOFT S.A.S.`:`${opening}, soy Luisa, asistente comercial de LUXISOFT S.A.S.`;
 if(identityRequest(raw))return identity;
 if(onlyGreeting(raw))return identity;
 return body?identity+'\n\n'+body:'';
}
export function redundantAdvisorBody(text:string,raw:string,history:ChatMessage[]) {
 if(quotedRequest(raw)||identityRequest(raw)||/repite|otra vez|nuevamente|resum|repeat|again|repita|compar|antes de pagar/i.test(raw))return false;
 if(/^(?:asistente|asesora|assistente|virtual sales assistant)\b/i.test(text))return true;
 const normalized=plain(text),last=history.filter(m=>m.role==='assistant').at(-1)?.content?.replace(/^\[[^\]\n]{1,100}\]\s*/,'')??'';
 if(normalized&&normalized===plain(last))return true;
 const questions=text.match(/[^.!?\n]*\?/g)??[];
 if(questions.length>1)return true;
 const questionKey=(s:string)=>plain(s).replace(/[^a-z0-9 ]/g,'').split(' ').filter(w=>w.length>3&&!['quieres','puedo','would','please','puede','conocer','explique','mostrar','gustaria','quiere'].includes(w));
 const previous=last.match(/[^.!?\n]*\?/g)??[];
 const affirmative=/^(si|claro|adelante|ok|de acuerdo|yes|sim|vale|dale)(?:[,\s]+(?:por favor|please|gracias))?[.!\s]*$/i.test(plain(raw));
 if(affirmative&&questions.some(q=>previous.some(old=>{const a=questionKey(q),b=new Set(questionKey(old));return a.length>0&&a.filter(w=>b.has(w)).length/a.length>=0.75;})))return true;
 const users=plain(history.filter(m=>m.role==='user').map(m=>m.content).join(' '));
 return (/como se llama (?:tu |el )?negocio/i.test(normalized)&&/se llama|negocio es/.test(users))||(/(?:tu nombre|como te llamas)/i.test(normalized)&&/me llamo|mi nombre es/.test(users));
}
export function advisorPrompt(base:string) {
 return base.replace(/Termina la presentaci[oó]n individual con una pregunta natural como[^\n]+/g,'').replace(/Recoge nombre, correo, negocio\/profesi[oó]n y objetivo sin repetir el tel[eé]fono del chat;/g,'Recoge únicamente los datos necesarios que falten y que el cliente aporte voluntariamente;');
}

/** Conversation constraints shared by Luxisoft channels, independent of sales policy. */
export const informationInstructions = `RESPUESTA INFORMATIVA: Responde la consulta y termina. Por defecto cero preguntas, cero sondeos comerciales y cero invitaciones como «cuéntame», «dime qué necesitas», «si quieres te explico» o «puedo ayudarte con algo más». No descubras necesidades por iniciativa propia ni conviertas información en una tarea de diseño. Amplía solo lo solicitado; no repitas cuentas, planes o beneficios ajenos a la duda nueva. Saluda sin preguntar cómo está. Las preguntas se permiten si el cliente solicita expresamente un cuestionario, texto con preguntas u orientación mediante preguntas; también una confirmación o dato indispensable exigido por una herramienta para una operación expresamente solicitada. Conserva las condiciones esenciales y la seguridad.`;
export function requestsQuestions(raw:string) {
 return /(?:hazme|haga(?:me)?|hacerme|ask me|fa[cç]a).{0,25}(?:preguntas|questions|perguntas)|preg[uú]ntame|(?:gu[ií]ame|guide me|oriente-me).{0,25}(?:paso a paso|step by step|passo a passo)|(?:redact|escribe|crea|genera|traduc|traduza|translate|write|create).{0,55}(?:preguntas|questions|perguntas|cuestionario|questionnaire|faq)|(?:traduce|translate|traduza).{0,80}[¿?]/i.test(raw);
}
export function unsolicitedQuestion(text:string,raw:string,allowed=false) {
 if(allowed||requestsQuestions(raw))return false;
 const visible=text.replace(/https?:\/\/\S+/g,'');
 return /[¿?]/.test(visible)||/\b(?:cu[eé]ntame|cu[eé]ntenos|dime|d[ií]game|comparte|ind[ií]came|tell me|let me know|conte-me|me diga)\b|(?:si quieres|si deseas|if you (?:want|wish)|se quiser).{0,60}(?:explic|ayud|mostrar|contar|help|show|explain|ajud|explic)|(?:puedo|podemos|i can|we can|posso).{0,35}(?:ayudar(?:te)? con algo m[aá]s|mostrarte otro|explicarte m[aá]s|help with anything else|show you more)/i.test(visible);
}
/** Last-resort fallback retains complete informative sentences, never slices words. */
export function informativeFallback(text:string,raw:string,allowed=false) {
 if(allowed||requestsQuestions(raw))return text.trim();
 const sentences=[...new Intl.Segmenter('es',{granularity:'sentence'}).segment(text)].map(x=>x.segment.trim());
 // A trailing probe is removable only when all preceding sentences are complete statements.
 const first=sentences.findIndex(s=>unsolicitedQuestion(s,raw));
 if(first<0)return text.trim();
 if(sentences.slice(first).every(s=>unsolicitedQuestion(s,raw)))return sentences.slice(0,first).join(' ');
 return '';
}
