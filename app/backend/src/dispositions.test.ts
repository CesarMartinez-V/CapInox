import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
process.env.NODE_ENV='test';process.env.DEMO_DB_PATH=':memory:';

test('typed closes persist sale reference, follow-up timestamp, final assignee and new session after CLOSED',async()=>{
  const {db,persistInbound}=await import('./db.js');
  const {config}=await import('./config.js');
  const {httpServer}=await import('./server.js');
  const {normalizeProviderEvent}=await import('./normalize.js');
  const victor=randomUUID(),token=randomUUID(),old=globalThis.fetch;
  config.MESSAGESYNC_API_KEY='fixture-key';config.GHL_LOCATION_ID='fixture-location';
  db.prepare("INSERT INTO agents(id,username,role) VALUES (?,'victor','SUPERADMIN')").run(victor);
  db.prepare('INSERT INTO sessions(token_hash,agent_id,expires_at) VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),victor,Date.now()+60000);
  globalThis.fetch=async()=>Response.json({id:randomUUID()});
  await new Promise<void>(resolve=>httpServer.listen(0,'127.0.0.1',resolve));
  try{
    const addr=httpServer.address();assert.ok(addr&&typeof addr!=='string');
    const post=(id:string,body:object)=>old(`http://127.0.0.1:${addr.port}/api/conversations/${id}/close`,{method:'POST',headers:{Cookie:`cap_session=${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const contact=randomUUID();
    const newSession=(messageId:string)=>{
      const item=persistInbound(normalizeProviderEvent({event:'whatsapp.inbound',payload:{messageId,contact:{id:contact},message:{text:'Hola'}}}))!;
      db.prepare("UPDATE conversations SET mode='HUMAN_ACTIVE',assigned_agent_id=? WHERE id=?").run(victor,item.conversationId);
      return item;
    };
    const sale=newSession(randomUUID());
    assert.equal((await post(sale.conversationId,{disposition:'SALE_COMPLETED',saleAmount:123.5,saleReference:'FACT-123',note:'Entregado'})).status,202);
    for(let i=0;i<100&&(db.prepare('SELECT mode FROM conversations WHERE id=?').get(sale.conversationId) as {mode:string}).mode!=='CLOSED';i++)await new Promise(resolve=>setTimeout(resolve,10));
    const row=db.prepare('SELECT disposition,sale_amount,sale_reference,closed_by,final_assignee_id,close_note FROM conversations WHERE id=?').get(sale.conversationId) as {disposition:string;sale_amount:number;sale_reference:string;closed_by:string;final_assignee_id:string;close_note:string};
    assert.deepEqual(row,{disposition:'SALE_COMPLETED',sale_amount:123.5,sale_reference:'FACT-123',closed_by:victor,final_assignee_id:victor,close_note:'Entregado'});
    const follow=newSession(randomUUID());assert.notEqual(follow.conversationId,sale.conversationId);
    assert.equal((await post(follow.conversationId,{disposition:'FOLLOW_UP',followUpAt:'2026-10-04T15:00:00.000Z'})).status,202);
    for(let i=0;i<100&&(db.prepare('SELECT mode FROM conversations WHERE id=?').get(follow.conversationId) as {mode:string}).mode!=='CLOSED';i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal((db.prepare('SELECT follow_up_at FROM conversations WHERE id=?').get(follow.conversationId) as {follow_up_at:string}).follow_up_at,'2026-10-04T15:00:00.000Z');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE contact_id=(SELECT id FROM contacts WHERE provider_contact_id=?)').get(contact) as {n:number}).n,2);
  }finally{globalThis.fetch=old;await new Promise<void>(resolve=>httpServer.close(()=>resolve()));}
});
