import {afterEach,expect,it,vi} from 'vitest';
import {configureInboxOwnershipReader,messengerOwnershipGuard} from './inboxAiOwnership.js';
afterEach(()=>configureInboxOwnershipReader(null));
it('reads only the exact project, Messenger identity and generation start',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[{paused:false}]});configureInboxOwnershipReader({query});
 expect(await messengerOwnershipGuard('one',{channel:'messenger',from:'messenger:123'})()).toBe(false);
 expect(query.mock.calls[0][1]).toEqual(['one','123',expect.any(Date)]);
 expect(query.mock.calls[0][0]).toContain("e.event_type='conversation_claimed'");
});
it('notices human ownership after generation has already started',async()=>{
 const query=vi.fn().mockResolvedValueOnce({rows:[{paused:false}]}).mockResolvedValueOnce({rows:[{paused:true}]});configureInboxOwnershipReader({query});
 const guard=messengerOwnershipGuard('one',{channel:'messenger',from:'messenger:123'});
 expect(await guard()).toBe(false);expect(await guard()).toBe(true);
});
it('fails closed on missing or unavailable inbox state',async()=>{
 const query=vi.fn().mockResolvedValue({rows:[]});configureInboxOwnershipReader({query});
 const guard=messengerOwnershipGuard('one',{channel:'messenger',from:'messenger:123'});
 expect(await guard()).toBe(true);query.mockRejectedValueOnce(new Error('database unavailable'));await expect(guard()).rejects.toThrow('database unavailable');
});
it('keeps WhatsApp and other identities on their existing authorization path',async()=>{
 const query=vi.fn();configureInboxOwnershipReader({query});
 for(const context of [{channel:'whatsapp',from:'+123'},{channel:'messenger',from:'whatsapp:123'},{}])expect(await messengerOwnershipGuard('one',context)()).toBe(false);
 expect(query).not.toHaveBeenCalled();
});
