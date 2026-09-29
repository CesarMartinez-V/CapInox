import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
process.env.DEMO_DB_PATH=':memory:';

test('durable per-contact worker recovers an expired lease, serializes burst and coalesces AI text',async()=>{
  const {config}=await import('./config.js');
  const {db,persistInbound}=await import('./db.js');
  const {normalizeProviderEvent}=await import('./normalize.js');
  const {wakeJobs}=await import('./worker.js');
   const original=globalThis.fetch,previousUrl=config.N8N_AI_WEBHOOK_URL,previousDelay=config.AI_MESSAGE_DEBOUNCE_MS,previousPolicy=config.HANDOFF_NO_AGENT_POLICY;
   config.N8N_AI_WEBHOOK_URL='https://ai.fixture.test/route';config.AI_MESSAGE_DEBOUNCE_MS=200;
   config.HANDOFF_NO_AGENT_POLICY='WAIT_QUEUE';
  let aiCalls=0;
  globalThis.fetch=async(url)=>{
    if(String(url).includes('ai.fixture.test')){aiCalls++;return Response.json({success:true,route:'AI',reply:'Bien, te ayudo.'});}
    return Response.json({id:randomUUID()});
  };
  try{
    const contact=randomUUID();
    const inputs=['Hola','9','1','Necesito','amortiguadores','para una Hilux 2018'];
    const items=inputs.map(text=>persistInbound(normalizeProviderEvent({event:'whatsapp.inbound',timestamp:new Date().toISOString(),payload:{messageId:randomUUID(),contact:{id:contact},message:{text}}}))!);
    db.prepare("UPDATE jobs SET status='PROCESSING',lease_expires_at=? WHERE message_id=?").run(Date.now()-1,items[0].id);
    wakeJobs();
    for(let i=0;i<200;i++){
      const done=(db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='DONE'").get() as {n:number}).n;
      if(done===inputs.length)break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal((db.prepare("SELECT COUNT(*) n FROM jobs WHERE status='DONE'").get() as {n:number}).n,inputs.length);
    assert.equal(aiCalls,1);
    const rows=db.prepare('SELECT sequence,direction,route,text FROM messages WHERE conversation_id=? ORDER BY sequence').all(items[0].conversationId) as Array<{sequence:number;direction:string;route:string;text:string}>;
    assert.deepEqual(rows.map(x=>x.sequence),rows.map((_,index)=>index+1));
    assert.deepEqual(rows.filter(x=>x.direction==='inbound').map(x=>x.route),['MENU','MENU','PRESET','AI','AI','AI']);
    assert.equal(rows.filter(x=>x.direction==='outbound'&&x.route==='AI').length,1);
    assert.equal((db.prepare('SELECT invalid_menu_attempts FROM conversations WHERE id=?').get(items[0].conversationId) as {invalid_menu_attempts:number}).invalid_menu_attempts,1);
    const extra=['Necesito cotizar','quiero un asesor'].map(text=>persistInbound(normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId:randomUUID(),contact:{id:contact},message:{text}}}))!);
    wakeJobs();
    for(let i=0;i<100;i++){if(extra.every(x=>(db.prepare('SELECT processed_at FROM messages WHERE id=?').get(x.id) as {processed_at:string|null}).processed_at))break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal((db.prepare('SELECT mode FROM conversations WHERE id=?').get(items[0].conversationId) as {mode:string}).mode,'HUMAN_PENDING');
    assert.equal(aiCalls,2);
    assert.equal((db.prepare('SELECT route FROM messages WHERE id=?').get(extra[1].id) as {route:string}).route,'PRESET');
    assert.equal(persistInbound(normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId:db.prepare('SELECT provider_message_id FROM messages WHERE id=?').get(items[0].id) && (db.prepare('SELECT provider_message_id FROM messages WHERE id=?').get(items[0].id) as {provider_message_id:string}).provider_message_id,contact:{id:contact},message:{text:'Hola'}}})),null);
   }finally{globalThis.fetch=original;config.N8N_AI_WEBHOOK_URL=previousUrl;config.AI_MESSAGE_DEBOUNCE_MS=previousDelay;config.HANDOFF_NO_AGENT_POLICY=previousPolicy;}
});
