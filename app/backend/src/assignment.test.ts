import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
process.env.DEMO_DB_PATH=':memory:';

test('3 online agents share 10 pending chats atomically, respect capacity and ignore stale presence',async()=>{
  const {config}=await import('./config.js');
  const {db,persistInbound}=await import('./db.js');
  const {normalizeProviderEvent}=await import('./normalize.js');
  const {transitionConversation}=await import('./state.js');
  const {assignPending}=await import('./assignment.js');
  const oldFetch=globalThis.fetch,oldAuto=config.AUTO_ASSIGN_HUMAN;
  config.AUTO_ASSIGN_HUMAN='true';
  globalThis.fetch=async()=>Response.json({id:randomUUID()});
  try{
    for(let i=0;i<3;i++)db.prepare('INSERT INTO agents(id,username,name,status,max_active_chats,last_seen_at) VALUES (?,?,?,?,?,?)').run(`agent-${i}`,`agent-${i}`,`Agent ${i}`,'ONLINE',4,new Date().toISOString());
    const ids:string[]=[];
    for(let i=0;i<10;i++){
      const event=normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId:randomUUID(),contact:{id:randomUUID()},message:{text:'Hola'}}});
      const item=persistInbound(event)!;ids.push(item.conversationId);
      assert.equal(transitionConversation(item.conversationId,'REQUEST_HUMAN').ok,true);
      db.prepare('UPDATE conversations SET handoff_at=? WHERE id=?').run(new Date(Date.now()+i*1000).toISOString(),item.conversationId);
    }
    await Promise.all([assignPending(),assignPending(),assignPending()]);
    const rows=db.prepare("SELECT id,assigned_agent_id FROM conversations WHERE id IN ("+ids.map(()=>'?').join(',')+")").all(...ids) as Array<{id:string;assigned_agent_id:string|null}>;
    assert.equal(rows.filter(x=>x.assigned_agent_id).length,10);
    assert.equal(new Set(rows.map(x=>x.id)).size,10);
    const loads=db.prepare('SELECT id,active_chat_count FROM agents ORDER BY id').all() as Array<{id:string;active_chat_count:number}>;
    assert.deepEqual(loads.map(x=>x.active_chat_count).sort(),[3,3,4]);
    const first=rows.find(x=>x.assigned_agent_id==='agent-0')!;
    assert.equal(transitionConversation(first.id,'RETURN_MENU').ok,true);
    const stale=db.prepare('UPDATE agents SET last_seen_at=? WHERE id=?').run(new Date(Date.now()-3600000).toISOString(),'agent-0');assert.equal(stale.changes,1);
    const next=persistInbound(normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId:randomUUID(),contact:{id:randomUUID()},message:{text:'Hola'}}}))!;
    transitionConversation(next.conversationId,'REQUEST_HUMAN');
    await assignPending();
    const assigned=db.prepare('SELECT assigned_agent_id FROM conversations WHERE id=?').get(next.conversationId) as {assigned_agent_id:string|null};
    assert.notEqual(assigned.assigned_agent_id,'agent-0');
  }finally{config.AUTO_ASSIGN_HUMAN=oldAuto;globalThis.fetch=oldFetch;}
});
