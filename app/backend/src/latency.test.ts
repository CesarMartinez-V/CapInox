import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {io as client} from 'socket.io-client';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('inbound emits immediately and human API accepts 202 before slow MessageSync outbound',async()=>{
  const {db}=await import('./db.js');const {httpServer}=await import('./server.js');const {config}=await import('./config.js');
  const admin=randomUUID(),contact=randomUUID(),conversation=randomUUID(),token=randomUUID(),original=globalThis.fetch;
  config.GHL_LOCATION_ID='fixture-location';config.MESSAGESYNC_API_KEY='fixture-key';config.WEBHOOK_INGRESS_SECRET='fixture-secret-12345678901234567890';
  db.prepare("INSERT INTO agents(id,username,role,status,manual_status,connection_count,last_seen_at) VALUES (?,'victor','SUPERADMIN','ONLINE','ONLINE',1,?)").run(admin,new Date().toISOString());
  db.prepare('INSERT INTO sessions(token_hash,agent_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),admin,Date.now()+60000);
  db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(contact,randomUUID());
  db.prepare("INSERT INTO conversations(id,contact_id,mode,assigned_agent_id) VALUES (?,?,'HUMAN_ACTIVE',?)").run(conversation,contact,admin);
  let releaseProvider:((value:Response)=>void)|undefined;
  globalThis.fetch=async(input,init)=>String(input).startsWith('https://api.messagesync.ai/')?await new Promise<Response>(resolve=>{releaseProvider=resolve;}):original(input,init);
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  const address=httpServer.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  const socket=client(base,{transports:['websocket'],extraHeaders:{Cookie:`cap_session=${token}`}});
  try{
    await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    const created:Array<{message:{id:string;direction:string;client_message_id?:string};correlationId:string}>=[];
    socket.on('message:created',(payload,ack)=>{created.push(payload);ack({receivedAt:new Date().toISOString()});});
    const inboundId=randomUUID(),providerEventTime=new Date(Date.now()-250).toISOString();
    const began=performance.now();
    const inbound=await original(`${base}/webhooks/messagesync/${config.WEBHOOK_INGRESS_SECRET}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({event:'whatsapp.inbound',timestamp:providerEventTime,locationId:config.GHL_LOCATION_ID,payload:{messageId:inboundId,contact:{id:(db.prepare('SELECT provider_contact_id FROM contacts WHERE id=?').get(contact) as {provider_contact_id:string}).provider_contact_id},message:{text:'Hola asesor'}}})});
    assert.equal(inbound.status,202);assert.ok(performance.now()-began<1000);
    const incoming=(db.prepare('SELECT id FROM messages WHERE provider_message_id=?').get(inboundId) as {id:string}).id;
    for(let i=0;i<50&&!created.some(e=>e.message.id===incoming);i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(created.some(e=>e.message.id===incoming),'inbound must be emitted before routing finishes');
    const inputTrace=db.prepare('SELECT correlation_id,db_persisted_at,socket_emitted_at,provider_event_timestamp FROM message_latency WHERE message_id=?').get(incoming) as {correlation_id:string;db_persisted_at:string;socket_emitted_at:string;provider_event_timestamp:string};
    assert.ok(inputTrace.correlation_id&&inputTrace.db_persisted_at&&inputTrace.socket_emitted_at);assert.equal(inputTrace.provider_event_timestamp,providerEventTime);
    const requestId=randomUUID();
    const beginSend=performance.now();
    const accepted=await original(`${base}/api/conversations/${conversation}/messages`,{method:'POST',headers:{Cookie:`cap_session=${token}`,'Content-Type':'application/json'},body:JSON.stringify({text:'LATENCY TEST 002',clientRequestId:requestId,clientCreatedAt:new Date().toISOString()})});
    assert.equal(accepted.status,202);assert.ok(performance.now()-beginSend<1000,'API must not await MessageSync');
    const result=await accepted.json();assert.equal(result.status,'pending');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM outbound_jobs WHERE message_id=?').get(result.messageId) as {n:number}).n,1);
    assert.ok((db.prepare('SELECT api_accept_ms FROM message_latency WHERE message_id=?').get(result.messageId) as {api_accept_ms:number}).api_accept_ms<1000);
    releaseProvider?.(Response.json({id:randomUUID()}));
    for(let i=0;i<100&&(db.prepare('SELECT delivery_status FROM messages WHERE id=?').get(result.messageId) as {delivery_status:string}).delivery_status!=='sent';i++)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal((db.prepare('SELECT delivery_status FROM messages WHERE id=?').get(result.messageId) as {delivery_status:string}).delivery_status,'sent');
    const report=await original(`${base}/api/diagnostics/latency?minutes=15`,{headers:{Cookie:`cap_session=${token}`}});assert.equal(report.status,200);
    assert.ok((await report.json()).metrics.db_persist_ms.count>=2);
  }finally{socket.disconnect();globalThis.fetch=original;await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});
