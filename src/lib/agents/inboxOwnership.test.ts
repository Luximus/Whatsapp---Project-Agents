import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('./registry.js',()=>({loadAgent:async()=>({projectKey:'one',tools:[],systemPrompt:''}),listAgentProjects:()=>[]}));
vi.mock('./runtime.js',()=>({runAgent:state.run}));
import {handleAgentMessage,clearAgentCache} from './index.js';
import {configureInboxOwnershipReader} from '../inboxAiOwnership.js';
afterEach(()=>{configureInboxOwnershipReader(null);clearAgentCache();vi.clearAllMocks()});
it('drops text and rich output when support takes Messenger while the model is working',async()=>{
 let taken=false;configureInboxOwnershipReader({query:async()=>({rows:[{paused:taken}]})});
 state.run.mockImplementationOnce(async options=>{expect(await options.isSuperseded()).toBe(false);taken=true;expect(await options.isSuperseded()).toBe(true);return {text:'old response',rich:[{kind:'image'}],turns:1};});
 const result=await handleAgentMessage({projectKey:'one',userMessage:'hello',context:{channel:'messenger',from:'messenger:123'}});
 expect(result.text).toBe('');expect(result.rich).toEqual([]);
});
it('returns normal responses when no operator took the chat',async()=>{
 configureInboxOwnershipReader({query:async()=>({rows:[{paused:false}]})});state.run.mockResolvedValueOnce({text:'hello',rich:[],turns:1});
 expect((await handleAgentMessage({projectKey:'one',userMessage:'hello',context:{channel:'messenger',from:'messenger:123'}})).text).toBe('hello');
});
