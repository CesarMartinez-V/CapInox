import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('outbound queue persists first, retries definitive 503, fails 400, and quarantines ambiguous/expired sends',async()=>{
  const {db,getConversation,insertOutbound}=await import('./db.js');
  const {dispatchOutbound,wakeOutbound,startOutboundWorker,stopOutboundWorker,retryOutboundJob}=await import('./outbound.js');
  const {config}=await import('./config.js');
  config.GHL_LOCATION_ID='fixture-location';config.MESSAGESYNC_API_KEY='fixture-key';
  const cid=randomUUID(),contact=randomUUID();
  db.prepare('INSERT INTO contacts(id,provider_contact_id) VALUES (?,?)').run(contact,randomUUID());
  db.prepare("INSERT INTO conversations(id,contact_id,mode) VALUES (?,?,'MENU')").run(cid,contact);
  const original=globalThis.fetch;let calls=0,behavior:'503'|'400'|'timeout'|'success'='503';
  globalThis.fetch=async()=>{calls++;if(behavior==='timeout')throw new Error('timeout ambiguous');return new Response(JSON.stringify({id:randomUUID()}),{status:behavior==='503'?503:behavior==='400'?400:200,headers:{'Content-Type':'application/json'}});};
  const add=(text:string)=>insertOutbound(getConversation(cid)!,text,'bot','MENU').id;
  const status=(id:string)=>db.prepare('SELECT j.status,j.attempt_count,m.delivery_status FROM outbound_jobs j JOIN messages m ON m.id=j.message_id WHERE j.message_id=?').get(id) as {status:string;attempt_count:number;delivery_status:string};
  try{
    const retry=add('retry');assert.equal(status(retry).status,'PENDING');
    await assert.rejects(dispatchOutbound(retry));assert.deepEqual(status(retry),{status:'PENDING',attempt_count:1,delivery_status:'pending'});
    behavior='success';db.prepare('UPDATE outbound_jobs SET available_at=0 WHERE message_id=?').run(retry);wakeOutbound();
    for(let i=0;i<100&&status(retry).status!=='SENT';i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(status(retry).status,'SENT');assert.equal(status(retry).attempt_count,2);
    behavior='400';const permanent=add('permanent');await assert.rejects(dispatchOutbound(permanent));
    assert.equal(status(permanent).status,'FAILED');
    behavior='timeout';const ambiguous=add('ambiguous');await assert.rejects(dispatchOutbound(ambiguous));
    assert.equal(status(ambiguous).status,'UNKNOWN');const before=calls;wakeOutbound();await new Promise(r=>setTimeout(r,30));assert.equal(calls,before);
    const lost=add('in-flight');db.prepare("UPDATE outbound_jobs SET status='SENDING',locked_at=? WHERE message_id=?").run(Date.now()-130000,lost);
    startOutboundWorker();assert.equal(status(lost).status,'UNKNOWN');assert.equal(calls,before);
    assert.equal(retryOutboundJob((db.prepare('SELECT id FROM outbound_jobs WHERE message_id=?').get(lost) as {id:string}).id),false);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM outbound_jobs WHERE message_id=?').get(retry) as {n:number}).n,1);
    stopOutboundWorker();behavior='503';const exhausted=add('retry-budget');
    for(let attempt=1;attempt<=config.OUTBOUND_MAX_ATTEMPTS;attempt++){
      db.prepare('UPDATE outbound_jobs SET available_at=0 WHERE message_id=?').run(exhausted);
      await assert.rejects(dispatchOutbound(exhausted));
      assert.equal(status(exhausted).status,attempt===config.OUTBOUND_MAX_ATTEMPTS?'FAILED':'PENDING');
    }
    assert.equal(status(exhausted).attempt_count,config.OUTBOUND_MAX_ATTEMPTS);
  }finally{stopOutboundWorker();globalThis.fetch=original;}
});
