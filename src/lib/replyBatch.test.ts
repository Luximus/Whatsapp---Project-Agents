import {it,expect,vi,afterEach}from'vitest';
import{replyBatch}from'./replyBatch.js';
afterEach(()=>vi.useRealTimers());
it('skips immediately when another message is already accepted',async()=>{const db={query:vi.fn(async()=>({rows:[{newer:true}]}))};expect(await replyBatch(db,'p','c','+123','m').ready()).toBe(false);expect(db.query).toHaveBeenCalledOnce();});
it('waits for a quiet window and notices arrivals during it',async()=>{vi.useFakeTimers();const db={query:vi.fn().mockResolvedValueOnce({rows:[{newer:false}]}).mockResolvedValueOnce({rows:[{newer:true}]})};const ready=replyBatch(db,'p','c','+123','m').ready();await vi.advanceTimersByTimeAsync(3000);expect(await ready).toBe(false);});
it('combines the unanswered messages in their original order',async()=>{const db={query:vi.fn(async()=>({rows:[{content:'quiero una página'},{content:'para mi restaurante'}]}))};expect(await replyBatch(db,'p','c','+123','m').text('fallback')).toBe('quiero una página\npara mi restaurante');expect(db.query.mock.calls[0]?.length).toBeGreaterThan(0);});
