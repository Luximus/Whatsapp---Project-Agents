import {describe,it,expect,vi} from 'vitest';
import {advisorPolicy,advisorViolation} from './advisorPolicy.js';
const toolPath='../../../agents/luxisoft/scripts/getPlatformAccountOffer.js';
const {default:offer}=await import(toolPath);
const catalog=(extra={})=>({status:'ok',catalog:{expiresAt:Date.now()+60000,fetchedAt:new Date().toISOString(),data:{plans:[{code:'free',aiUsage:{version:1,multiplier:1,renewal:'rolling_week'},storageBytes:2147483648,periods:[]},{code:'plus',periods:[{code:'m1',priceCopCents:2990000,totalCopCents:35880000,installments:12}]}],freeAllowance:null,...extra}}});
describe('Free before paid plans',()=>{
 it('loads free limits without exposing paid prices',async()=>{
  const action=vi.fn(async()=>catalog());
  const r=JSON.parse(await offer.execute({}, {actions:{getCommercialCatalog:action}}));
  expect(action).toHaveBeenCalledOnce();expect(r.freeAccess.plan.aiUsage.multiplier).toBe(1);
  expect(r.catalog).toBeUndefined();expect(r.orientation).toMatch(/gratuita.*x1.*7 días.*modalidades de pago/);
 });
 it('retains Free first when price is requested and converts cents',async()=>{
  const r=JSON.parse(await offer.execute({includePrices:true},{actions:{getCommercialCatalog:async()=>catalog()}}));
  expect(r.catalog.plans.map((p:{code:string})=>p.code)).toEqual(['free','plus']);
  expect(r.catalog.plans[1].periods[0].priceCop.amount).toBe(29900);
 });
 it('does not fabricate allowance on expired catalog',async()=>{
  const r=JSON.parse(await offer.execute({}, {actions:{getCommercialCatalog:async()=>({status:'ok',catalog:{...catalog().catalog,expiresAt:1}})}}));
  expect(r.freeAccessStatus).toBe('unavailable');expect(r.freeAccess).toBeUndefined();
 });
 it('rejects the reported paid-first response',()=>{
  expect(advisorViolation('Puedes crear tu cuenta propia en Luxisoft y usar Chatbox con modelos de OpenAI. El plan Plus cuesta $29.900 COP mensuales.',advisorPolicy('¿Cuánto cuesta tener una cuenta de IA?'))).toBe(true);
 });
 it('accepts free limits and payment facilities without paid prices',()=>{
  expect(advisorViolation('Puedes crear una cuenta gratuita en Luxisoft para consultas y páginas. Incluye uso semanal x1, sin acumular; las recargas de Tokens son opcionales. Hay planes avanzados opcionales con facilidades de pago.',advisorPolicy('Necesito una cuenta ChatGPT'))).toBe(false);
 });
 it('does not force a free introduction for a specific plan or accepted registration',()=>{
  expect(advisorPolicy('¿Cuánto cuesta el plan Plus de IA?').specificPlan).toBe(true);
  expect(advisorPolicy('Sí, por favor',[{role:'assistant',content:'En Luxisoft puedes crear tu cuenta. ¿Quieres el enlace?'}]).accountContinuation).toBe(true);
 });
});
