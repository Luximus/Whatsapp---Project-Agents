import{describe,it,expect,vi,beforeEach}from'vitest';
import{unsolicitedQuestion,informativeFallback,composeAdvisorReply}from'./advisorResponse.js';
const mocks=vi.hoisted(()=>({complete:vi.fn()}));
vi.mock('../ai/chat/index.js',()=>({getDefaultChatProvider:()=>({name:'openai',complete:mocks.complete}),createChatProvider:()=>({name:'openai',complete:mocks.complete})}));
import{runAgent}from'./runtime.js';
const reply=(text:string)=>({text,toolCalls:[],provider:'openai',model:'m'});
beforeEach(()=>mocks.complete.mockReset());
describe('information without unsolicited follow-up',()=>{
 it.each(['¿Qué tipo de imagen necesitas generar?','¿Producto, promoción o logo?','Cuéntame más de tu negocio.','Si quieres te explico otros planes.','Tell me more.','Se quiser, posso explicar.'])('rejects follow-up: %s',text=>expect(unsolicitedQuestion(text,'se pueden generar imágenes')).toBe(true));
 it('retains a requested question in translation',()=>expect(unsolicitedQuestion('How are you?','Traduce: ¿Cómo estás?')).toBe(false));
 it('allows an explicitly requested questionnaire',()=>expect(unsolicitedQuestion('¿Qué producto vendes?','Hazme preguntas para preparar la propuesta')).toBe(false));
 it('does not mistake a registration URL for a question',()=>expect(unsolicitedQuestion('Registro: https://luxisoft.com/es/auth?next=home','Envíame el enlace')).toBe(false));
 it('retains complete conditions before a trailing probe',()=>expect(informativeFallback('Son 12 pagos de $29.900 COP; total $358.800 COP. ¿Quieres otro plan?','Precio Plus')).toBe('Son 12 pagos de $29.900 COP; total $358.800 COP.'));
 it.each(['es','en','pt'])('greetings do not ask courtesy questions in %s',locale=>{expect(composeAdvisorReply('','Hola',true,locale)).not.toContain('?');expect(composeAdvisorReply('','Hola',false,locale)).not.toContain('?');});
 it.each(['whatsapp','messenger']as const)('rephrases once without tools in %s',async channel=>{
  mocks.complete.mockResolvedValueOnce(reply('Sí, puedes generar imágenes para tu negocio. ¿Cuál quieres primero?')).mockResolvedValueOnce(reply('Sí, puedes generar imágenes para tu negocio.'));
  const r=await runAgent({agent:{projectKey:'luxisoft',systemPrompt:'Atención',tools:[]},userMessage:'imagenes para mi negocio de perros calientes',firstContact:false,context:{projectKey:'luxisoft',channel}});
  expect(r.text).toBe('Sí, puedes generar imágenes para tu negocio.');expect(mocks.complete).toHaveBeenCalledTimes(2);expect(mocks.complete.mock.calls[1][0].tools).toEqual([]);
 });
 it('retains useful information when the correction still asks',async()=>{mocks.complete.mockResolvedValue(reply('Puedes crear imágenes de producto y promociones. ¿Qué imagen quieres?'));const r=await runAgent({agent:{projectKey:'luxisoft',systemPrompt:'Atención',tools:[]},userMessage:'imagenes para perros calientes',firstContact:false,context:{projectKey:'luxisoft',channel:'whatsapp'}});expect(r.text).toBe('Puedes crear imágenes de producto y promociones.');});
});
it('preserves multiple questions explicitly requested by the customer',async()=>{mocks.complete.mockResolvedValue(reply('¿Qué producto vendes? ¿En qué ciudad?'));const r=await runAgent({agent:{projectKey:'luxisoft',systemPrompt:'Atención',tools:[]},userMessage:'Hazme preguntas para preparar una propuesta',firstContact:false,context:{projectKey:'luxisoft',channel:'whatsapp'}});expect(r.text).toBe('¿Qué producto vendes? ¿En qué ciudad?');expect(mocks.complete).toHaveBeenCalledOnce();});
