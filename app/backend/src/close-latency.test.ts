import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('close queues farewell with 202 without archiving until provider confirms',async()=>{
  const {db}=await import('./db.js');const {httpServer}=await import('./server.js');const {config}=await import('./config.js');
  const old=globalThis.fetch,actor=randomUUID(),contact=randomUUID(),conversation=randomUUID(),token=randomUUID();
  config.MESSAGESYNC_API_KEY='fixture-key';config.GHL_LOCATION_ID='fixture-location';
  db.prepare("INSERT INTO agents(id,username,role) VALUES (?,'victor','SUPERADMIN')").run(actor);
  db.prepare('INSERT INTO sessions(token_hash,agent_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),actor,Date.now()+60000);
  db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(contact,randomUUID());
  db.prepare("INSERT INTO conversations(id,contact_id,mode,assigned_agent_id) VALUES (?,?,'HUMAN_ACTIVE',?)").run(conversation,contact,actor);
  let confirm:((response:Response)=>void)|undefined;
  globalThis.fetch=async input=>String(input).startsWith('https://api.messagesync.ai/')?await new Promise<Response>(resolve=>{confirm=resolve;}):old(input);
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));const addr=httpServer.address();assert.ok(addr&&typeof addr!=='string');
  try{
    const began=performance.now();
    const response=await old(`http://127.0.0.1:${addr.port}/api/conversations/${conversation}/close`,{method:'POST',headers:{Cookie:`cap_session=${token}`,'Content-Type':'application/json'},body:JSON.stringify({disposition:'CONSULT_RESOLVED'})});
    assert.equal(response.status,202);assert.ok(performance.now()-began<1000);
    assert.equal((db.prepare('SELECT mode FROM conversations WHERE id=?').get(conversation) as {mode:string}).mode,'CLOSING');
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM outbound_jobs j JOIN messages m ON m.id=j.message_id WHERE m.conversation_id=? AND m.client_message_id=?").get(conversation,`close:${conversation}`) as {n:number}).n,1);
    for(let i=0;i<100&&!confirm;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(confirm);
    assert.equal((db.prepare('SELECT mode FROM conversations WHERE id=?').get(conversation) as {mode:string}).mode,'CLOSING');
    confirm(Response.json({id:randomUUID()}));
    for(let i=0;i<100&&(db.prepare('SELECT mode FROM conversations WHERE id=?').get(conversation) as {mode:string}).mode!=='CLOSED';i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal((db.prepare('SELECT mode FROM conversations WHERE id=?').get(conversation) as {mode:string}).mode,'CLOSED');
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='close' AND resource_id=?").get(conversation) as {n:number}).n,1);
  }finally{globalThis.fetch=old;await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});
