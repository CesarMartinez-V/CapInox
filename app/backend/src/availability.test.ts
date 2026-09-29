import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('20 effective agents route 100 chats; 20 overflow contacts get AI fallback, no silent pending or AI call',async()=>{
  const {config}=await import('./config.js');
  const {db,persistInbound,getConversation,getMessage}=await import('./db.js');
  const {normalizeProviderEvent}=await import('./normalize.js');
  const {routeMessage}=await import('./router.js');
  const {reassignDisconnected,assignPending}=await import('./assignment.js');
  const oldFetch=globalThis.fetch;let aiCalls=0;
  config.HANDOFF_NO_AGENT_POLICY='AI_FALLBACK';
  globalThis.fetch=async url=>{if(String(url).includes('ai.fixture')){aiCalls++;return Response.json({success:true,reply:'OK'});}return Response.json({id:randomUUID()});};
  try{
    for(let n=0;n<20;n++)db.prepare("INSERT INTO agents(id,username,status,manual_status,last_seen_at,connection_count,max_active_chats) VALUES (?,?,'ONLINE','ONLINE',?,1,5)").run(`agent-${n}`,`agent-${n}`,new Date().toISOString());
    const chats:string[]=[];
    for(let n=0;n<120;n++){
      const contact=randomUUID();
      for(const text of ['Hola','4']){
        const inbound=persistInbound(normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId:randomUUID(),contact:{id:contact},message:{text}}}))!;
        await routeMessage(inbound.id,inbound.isNew);
        if(text==='4'){
          await assignPending(true);
          chats.push(inbound.conversationId);
          assert.equal(getMessage(inbound.id)?.route,'PRESET');
        }
      }
    }
    const counts=db.prepare("SELECT SUM(mode='HUMAN_ACTIVE') AS active,SUM(mode='HUMAN_PENDING') AS pending,SUM(mode='AI') AS ai FROM conversations WHERE id IN ("+chats.map(()=>'?').join(',')+")").get(...chats) as {active:number;pending:number;ai:number};
    assert.deepEqual(counts,{active:100,pending:0,ai:20});
    const loads=db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE mode='HUMAN_ACTIVE' GROUP BY assigned_agent_id").all() as Array<{n:number}>;
    assert.equal(loads.length,20);assert.ok(loads.every(row=>row.n===5));
    assert.equal(aiCalls,0);
    const events=(db.prepare("SELECT COUNT(*) AS n FROM conversation_events WHERE event_type='handoff_unavailable_ai_fallback'").get() as {n:number}).n;
    assert.equal(events,20);
    const counter=(db.prepare("SELECT value FROM metrics_counters WHERE name='handoff_ai_fallback_total'").get() as {value:number}).value;
    assert.equal(counter,20);
    const overflow=chats.at(-1)!;
    assert.equal(getConversation(overflow)?.intent,'human_unavailable_fallback');
    const before=db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(overflow) as {n:number};
    const lastContact=(db.prepare('SELECT provider_contact_id FROM contacts WHERE id=(SELECT contact_id FROM conversations WHERE id=?)').get(overflow) as {provider_contact_id:string}).provider_contact_id;
    const again=persistInbound(normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId:randomUUID(),contact:{id:lastContact},message:{text:'asesor'}}}))!;
    await routeMessage(again.id);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(overflow) as {n:number}).n,before.n+1);
    // Disconnect grace: transfer an active chat only after stale heartbeat; never auto-switch it to AI.
    db.prepare('UPDATE agents SET connection_count=0,last_seen_at=? WHERE id=?').run(new Date(Date.now()-180000).toISOString(),'agent-0');
    db.prepare('UPDATE agents SET max_active_chats=6 WHERE id=?').run('agent-1');
    reassignDisconnected();
    const affected=db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE mode='HUMAN_ACTIVE' AND assigned_agent_id='agent-0'").get() as {n:number};
    assert.equal(affected.n,4);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM conversations WHERE assigned_agent_id='agent-0' AND needs_reassignment=1 AND mode='HUMAN_ACTIVE'").get() as {n:number}).n,4);
  }finally{globalThis.fetch=oldFetch;}
});
