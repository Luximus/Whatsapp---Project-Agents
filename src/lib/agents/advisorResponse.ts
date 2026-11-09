import type {ChatMessage} from '../ai/types.js';
export const plain = (s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const greeting=/^(?:hola|buenas(?: noches?| tardes?)?|buena noche|buenos d[ií]as|buen d[ií]a|hello|hi|hey|good (?:morning|afternoon|evening)|ol[aá]|oi|bom dia|boa (?:tarde|noite))(?=$|[!,.:;\s])[!,.:;\s]*/iu;
export const onlyGreeting=(s:string)=>greeting.test(plain(s))&&!plain(s).replace(greeting,'').replace(/[!.,\s]+/g,'');
const identityRequest=(raw:string)=>/quien eres|como te llamas|who are you|your name|qual.*nome/i.test(plain(raw));
const quotedRequest=(raw:string)=>/redact|traduc|traduza|translate|write.*message|escribe.*mensaje|ejemplo.*saludo|cita textual/i.test(raw);
export function advisorOpening(raw:string,locale:string,now=new Date()) {
 const s=plain(raw), hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Bogota',hour:'2-digit',hourCycle:'h23'}).format(now));
 const period=/buenas? noches?|good evening|boa noite/.test(s)?'night':/buenas tardes?|good afternoon|boa tarde/.test(s)?'afternoon':/buenos dias|buen dia|good morning|bom dia/.test(s)?'morning':hour<5||hour>=19?'night':hour>=12?'afternoon':'morning';
 return ({es:{morning:'Buenos días',afternoon:'Buenas tardes',night:'Buenas noches'},en:{morning:'Good morning',afternoon:'Good afternoon',night:'Good evening'},pt:{morning:'Bom dia',afternoon:'Boa tarde',night:'Boa noite'}}[locale as 'es'|'en'|'pt']??{morning:'Buenos días',afternoon:'Buenas tardes',night:'Buenas noches'})[period];
}
export function cleanAdvisorBody(text:string,raw:string) {
 if(quotedRequest(raw)||identityRequest(raw)) return text.trim();
 let body=text.trim();
 // Only remove conversational openings, never occurrences inside facts or quotes.
 for(let i=0;i<4;i++) {
  const before=body;
  body=body.replace(greeting,'').trim().replace(/^(?:soy|me llamo|i am|i'm|sou)\s+Luisa(?:,?\s*(?:asistente|assistente|the virtual sales assistant)[^!?\n]{0,100}?LUXISOFT S\.A\.S\.)?[.!,:]?\s*/iu,'').trim().replace(/^(?:¿?C[oó]mo te encuentras\?|How are you\?|Como voc[eê] est[aá]\?)\s*/iu,'');
  if(body===before)break;
 }
 const seen=new Set<string>();
 const sentences=new Set<string>();
 return body.split(/\n\s*\n/).filter(p=>{const key=plain(p);if(seen.has(key))return false;seen.add(key);return true;}).map(p=>[...new Intl.Segmenter('es',{granularity:'sentence'}).segment(p)].filter(({segment})=>{const key=plain(segment);if(key.length<15)return true;if(sentences.has(key))return false;sentences.add(key);return true;}).map(s=>s.segment).join('').trim()).filter(Boolean).join('\n\n');
}
export function composeAdvisorReply(text:string,raw:string,firstContact:boolean,locale:string,now=new Date()) {
 const body=cleanAdvisorBody(text,raw);
 if(!firstContact)return body;
 const opening=advisorOpening(raw,locale,now);
 const identity=locale==='en'?`${opening}, I'm Luisa, the virtual sales assistant at LUXISOFT S.A.S.`:locale==='pt'?`${opening}, sou Luisa, assistente comercial virtual da LUXISOFT S.A.S.`:`${opening}, soy Luisa, asistente comercial virtual de LUXISOFT S.A.S.`;
 if(identityRequest(raw))return identity;
 if(onlyGreeting(raw))return identity+' '+({es:'¿Cómo te encuentras?',en:'How are you?',pt:'Como você está?'}[locale as 'es'|'en'|'pt']??'¿Cómo te encuentras?');
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
