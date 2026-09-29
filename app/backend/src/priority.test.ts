import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('two stalled AI requests do not block HIGH human inbound routing',async()=>{
  const {db,persistInbound}=await import('./db.js');const {config}=await import('./config.js');
  const {startWorker,stopWorker,wakeJobs}=await import('./worker.js');
  const {normalizeProviderEvent}=await import('./normalize.js');
  config.N8N_AI_WEBHOOK_URL='https://ai.fixture.test/route';config.AI_MESSAGE_DEBOUNCE_MS=0;config.MESSAGESYNC_API_KEY='fixture';config.GHL_LOCATION_ID='fixture';
  const original=globalThis.fetch;let requests=0;const release:Array<(r:Response)=>void>=[];
  globalThis.fetch=async input=>String(input).includes('ai.fixture.test')?(requests++,await new Promise<Response>(resolve=>release.push(resolve))):Response.json({id:randomUUID()});
  const add=(mode:'AI'|'HUMAN_ACTIVE',text:string)=>{
    const contact=randomUUID(),providerId=randomUUID(),conversation=randomUUID();
    db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(contact,providerId);
    db.prepare('INSERT INTO conversations(id,contact_id,mode,next_sequence) VALUES (?,?,?,?)').run(conversation,contact,mode,mode==='AI'?2:0);
    return persistInbound(normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId:randomUUID(),contact:{id:providerId},message:{text}}}))!;
  };
  try{
    add('AI','Consulta lenta uno');add('AI','Consulta lenta dos');startWorker();wakeJobs();
    for(let i=0;i<100&&requests<2;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(requests,2);
    const high=add('HUMAN_ACTIVE','Mensaje para asesor'),started=performance.now();wakeJobs();
    for(let i=0;i<100;i++){if((db.prepare('SELECT processed_at FROM messages WHERE id=?').get(high.id) as {processed_at:string|null}).processed_at)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.ok((db.prepare('SELECT processed_at FROM messages WHERE id=?').get(high.id) as {processed_at:string|null}).processed_at);
    assert.ok(performance.now()-started<1000,'HIGH routing must not await stalled AI');
    const priority=db.prepare('SELECT queue_priority FROM message_latency WHERE message_id=?').get(high.id) as {queue_priority:string};assert.equal(priority.queue_priority,'HIGH');
  }finally{for(const resolve of release)resolve(Response.json({success:true,reply:'OK'}));stopWorker();globalThis.fetch=original;}
});
