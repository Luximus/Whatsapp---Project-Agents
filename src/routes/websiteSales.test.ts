import {it,expect,vi,beforeEach} from 'vitest';
import Fastify from 'fastify';
const mocks=vi.hoisted(()=>({query:vi.fn(),send:vi.fn(),record:vi.fn()}));
vi.mock('../lib/bridge.js',()=>({requireBridgeProjectAuth:(req:any)=>{if(req.headers.authorization!=='Bearer test')throw Object.assign(Error('unauthorized'),{statusCode:401});return {projectKey:'luxisoft'}}}));
vi.mock('../lib/whatsapp.js',()=>({sendWhatsappText:mocks.send}));vi.mock('../lib/inbox.js',()=>({recordInboxOutbound:mocks.record}));
import {websiteSalesRoutes} from './websiteSales.js';
const payload={marker:'sale-event',phone:'+19995550123',text:'Tu pedido está pagado.'};
beforeEach(()=>vi.clearAllMocks());
async function app(){const a=Fastify();a.decorate('pg',{query:mocks.query});await a.register(websiteSalesRoutes);return a;}
it('rejects an unauthorized notice',async()=>{const a=await app();const r=await a.inject({method:'POST',url:'/api/bridge/website-sales/notice',payload});expect(r.statusCode).toBe(401);expect(mocks.query).not.toHaveBeenCalled();await a.close()});
it('does not repeat a recorded notice',async()=>{mocks.query.mockResolvedValue({rows:[]});const a=await app();const r=await a.inject({method:'POST',url:'/api/bridge/website-sales/notice',headers:{authorization:'Bearer test'},payload});expect(r.json().data.status).toBe('already_recorded');expect(mocks.send).not.toHaveBeenCalled();await a.close()});
it('keeps notices pending outside the customer service window',async()=>{mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('INSERT')?[{marker:'sale-event'}]:[{id:'conversation',last_inbound_at:'2020-01-01'}]}));const a=await app();const r=await a.inject({method:'POST',url:'/api/bridge/website-sales/notice',headers:{authorization:'Bearer test'},payload});expect(r.json().data.status).toBe('pending_template');expect(mocks.send).not.toHaveBeenCalled();await a.close()});
it('records an uncertain send for review without a second send',async()=>{mocks.query.mockImplementation(async(sql:string)=>({rows:sql.includes('INSERT')?[{marker:'sale-event'}]:sql.includes('conversations')?[{id:'conversation',last_inbound_at:new Date()}]:[{content:'Quiero mi página'}]}));mocks.send.mockRejectedValue(Error('timeout'));const a=await app();const r=await a.inject({method:'POST',url:'/api/bridge/website-sales/notice',headers:{authorization:'Bearer test'},payload});expect(r.json().data.status).toBe('needs_review');expect(mocks.send).toHaveBeenCalledTimes(1);await a.close()});
